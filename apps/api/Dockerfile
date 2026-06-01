# ===========================================
# Base — pinned runtime + package manager
# ===========================================
# Debian slim (glibc), not Alpine (musl): the API depends on `sharp`/libvips for
# media processing. Slim ships sharp's prebuilt glibc binary with bundled libvips
# out of the box and matches the glibc CI runners. node:22 + pnpm@11.1.2 align
# with the repo's `engines` / `packageManager`. A CI-gated smoke test
# (.github/workflows/ci.yml) verifies a real sharp WebP encode plus module
# resolution inside the final runner image.
FROM node:22-slim AS base

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# ===========================================
# Build — install (incl. dev), build, deploy
# ===========================================
FROM base AS build

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
# need no install script here. The Prisma client is generated explicitly below.
RUN pnpm --filter api deploy --prod --legacy --ignore-scripts /prod/api
# `prisma` is a runtime dependency, so the CLI is present in the bundle. Generate
# the client into the self-contained node_modules (best practice: generate after
# deploy, when schema.prisma + the bundle are co-located).
RUN cd /prod/api && ./node_modules/.bin/prisma generate

# ===========================================
# Runner — minimal, self-contained, non-root
# ===========================================
FROM base AS runner

ENV NODE_ENV=production

# Prisma's query engine needs OpenSSL/libssl at runtime; node:22-slim omits it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Non-root user (Debian: groupadd/useradd; uid 1001 per k8s convention).
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --no-log-init --uid 1001 --gid nodejs nestjs

# The deployed bundle is fully self-contained: dist/, prisma/, prisma.config.ts,
# and a flat node_modules. Runtime requires resolve from /app/node_modules.
COPY --from=build --chown=nestjs:nodejs /prod/api ./

USER nestjs

EXPOSE 5002

CMD ["node", "dist/main.js"]
