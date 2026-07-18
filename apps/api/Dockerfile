# ===========================================
# Base — pinned runtime + package manager
# ===========================================
# Debian slim (glibc), not Alpine (musl): the API depends on `sharp`/libvips for
# media processing. Slim ships sharp's prebuilt glibc binary with bundled libvips
# out of the box and matches the glibc CI runners. node:22 + pnpm@11.1.2 align
# with the repo's `engines` / `packageManager`. A CI-gated smoke test
# (.github/workflows/ci.yml) verifies a real sharp WebP encode plus module
# resolution inside the final runner image.
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# ===========================================
# Build — install (incl. dev), generate, build, deploy
# ===========================================
FROM base AS build

# Prisma CLI runs in this build/migrator stage. Install OpenSSL explicitly so
# Prisma can resolve the Debian libssl target instead of falling back.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Manifests first so the install layer caches across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
# The api `postinstall` runs `prisma generate`, which needs the schema + config
# at install time (the placeholder datasource in prisma.config.ts lets it run
# without a DB).
COPY apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN pnpm install --frozen-lockfile

# Source, then build the shared package and the API.
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @amcore/shared build
RUN pnpm --filter api db:generate
RUN pnpm --filter api build

# Produce a self-contained production bundle (flat node_modules with all deps,
# including the workspace `@amcore/shared`, resolvable from the bundle root).
#
# `--legacy`: pnpm 11's `deploy` otherwise requires `injectWorkspacePackages=true`
# in pnpm-workspace.yaml to vendor workspace deps. `--legacy` is the documented
# fallback that doesn't need that global setting, so this packaging fix stays
# local to the Dockerfile and does NOT change the repo-wide dev install workflow
# for `@amcore/shared`. See ai/decisions/adr-038-pnpm-docker-deploy-packaging.md.
#
# `--ignore-scripts`: skip the api postinstall (which would re-run prisma
# generate during deploy); sharp/argon2 resolve prebuilt binaries at runtime and
# need no install script here. The Prisma client is source-generated before the
# API build, so the deployed app does not need the Prisma CLI.
RUN pnpm --filter api deploy --prod --legacy --ignore-scripts /prod/api

# pnpm still materializes Prisma's optional CLI peer variant in `.pnpm` when the
# workspace has the dev-only `prisma` package installed. The app imports only the
# generated source client plus `@prisma/client/runtime/client`; remove CLI/studio
# tooling from the app bundle and keep it only in the `migrator` target.
RUN find /prod/api/node_modules/.pnpm -maxdepth 1 \( \
      -name 'prisma@*' \
      -o -name '@prisma+config@*' \
      -o -name '@prisma+dev@*' \
      -o -name '@prisma+engines@*' \
      -o -name '@prisma+engines-version@*' \
      -o -name '@prisma+fetch-engine@*' \
      -o -name '@prisma+get-platform@*' \
      -o -name '@prisma+studio-core@*' \
      -o -name '@electric-sql+pglite*' \
      -o -name 'effect@*' \
      -o -name 'fast-check@*' \
    \) -prune -exec rm -rf {} +

# ===========================================
# Migrator — CLI-capable one-shot migration target
# ===========================================
# The app runner is intentionally CLI-free. Production migrations use this target
# (same source state, full build-stage dependencies) to run `prisma migrate deploy`
# once before web/worker rollout.
FROM build AS migrator

WORKDIR /app/apps/api

ENV NODE_ENV=production

CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ===========================================
# Runner — minimal, self-contained, non-root
# ===========================================
# Deliberately NOT `FROM base`: the runner must not inherit Corepack/pnpm. The
# container only runs `node dist/main.js`, so pnpm is never invoked at runtime.
# Shipping Corepack's bundled pnpm would also
# drag its vulnerable bundled `undici` into the image (CVE-2026-12151) and bloat
# the attack surface for no runtime benefit.
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runner

WORKDIR /app

ENV NODE_ENV=production

# TLS clients (S3, email providers, OAuth, HTTPS webhooks) need the system CA
# bundle; the Rust-free Prisma client no longer needs a bundled query engine.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root user (Debian: groupadd/useradd; uid 1001 per k8s convention).
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --no-log-init --uid 1001 --gid nodejs nestjs

# The deployed bundle is fully self-contained for app runtime: dist/ and a flat
# node_modules. Migration files/CLI live in the separate `migrator` target.
COPY --from=build --chown=nestjs:nodejs /prod/api ./

# The base image bundles its own npm/npx, unused here (only `node dist/main.js`
# runs at runtime) and a known source of base-image CVEs (e.g. its bundled
# sigstore, CVE-2026-48815). Remove it rather than carry the CVE for nothing.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER nestjs

EXPOSE 5002

CMD ["node", "dist/main.js"]
