# ===========================================
# Base — pinned runtime + package manager
# ===========================================
# Debian slim (glibc), not Alpine (musl): the API depends on `sharp`/libvips for
# media processing. Slim ships sharp's prebuilt glibc binary with bundled libvips
# out of the box and matches the glibc CI runners. node:24 + pnpm@12.15.0 align
# with the repo's `engines` / `packageManager`. A CI-gated smoke test
# (.github/workflows/ci.yml) verifies a real sharp WebP encode plus module
# resolution inside the final runner image.
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base

# The pinned base still carries vulnerable Perl; refresh it from Debian security
# updates in every API target until the base image includes the patched package.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade perl-base && \
    rm -rf /var/lib/apt/lists/*

# Update the whole npm distribution; ADD verifies the pinned upstream archive.
ADD --checksum=sha256:228bd64aaef23270dbdbd2cf3d5ef5c467602ef38c4066246cef1984adab9a67 https://registry.npmjs.org/npm/-/npm-12.2.1.tgz /tmp/npm.tgz
RUN npm install --global --ignore-scripts /tmp/npm.tgz && \
    test "$(npm --version)" = "12.2.1" && rm /tmp/npm.tgz && \
    corepack enable && corepack prepare pnpm@12.15.0 --activate

# The pnpm content-addressed store lives in a BuildKit cache mount (see the
# `--mount=type=cache,id=pnpm-store` steps below), not in an image layer. It
# persists across builds and is shared by every build on the machine — api and
# web, every worktree and stand — so a lockfile/prisma change that invalidates
# the install layer re-links packages from disk instead of re-downloading them.
# The store is integrity-addressed (lockfile hashes), so `--frozen-lockfile`
# verification is unchanged. Keep the store out of the image: it is not needed
# at runtime and would only inflate the layer.
ENV pnpm_config_store_dir=/pnpm/store
ENV pnpm_config_cache_dir=/pnpm/cache

WORKDIR /app

# ===========================================
# Build — install (incl. dev), generate, build, deploy
# ===========================================
FROM base AS build

# pnpm may reinstall before scripts after COPY; every install must keep the lockfile frozen.
ENV pnpm_config_frozen_lockfile=true

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
COPY docker/migrator/package.json ./docker/migrator/
# The api `postinstall` runs `prisma generate`, which needs the schema + config
# at install time (the placeholder datasource in prisma.config.ts lets it run
# without a DB).
COPY apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Source, then build the shared package and the API.
COPY packages ./packages
COPY apps/api ./apps/api
COPY scripts/typecheck-native.mjs ./scripts/typecheck-native.mjs
RUN pnpm --filter @amcore/shared build
RUN pnpm --filter api db:generate
ARG BUILD_SOURCE_COMMIT
# Optional build-only Node options (see apps/web/Dockerfile); scoped to this RUN.
ARG BUILD_NODE_OPTIONS=""
RUN BUILD_SOURCE_COMMIT="$BUILD_SOURCE_COMMIT" NODE_OPTIONS="$BUILD_NODE_OPTIONS" \
    pnpm --filter api build

# Produce a self-contained production bundle (flat node_modules with all deps,
# including the workspace `@amcore/shared`, resolvable from the bundle root).
#
# pnpm 12's `deploy` vendors workspace deps without `injectWorkspacePackages=true`
# and resolves from the frozen root lockfile, so the bundle holds exactly the
# locked production closure. The old `--legacy` mode re-resolved from the
# registry (newer versions, extra optional peers) and is no longer needed.
#
# `--ignore-scripts`: skip the api postinstall (which would re-run prisma
# generate during deploy); sharp/argon2 resolve prebuilt binaries at runtime and
# need no install script here. The Prisma client is source-generated before the
# API build, so the deployed app does not need the Prisma CLI.
#
# `deploy` imports packages from the pnpm store, which now lives in the cache
# mount rather than the image layer, so it needs the same mount. The supply-chain
# policy check fetches registry metadata on each run of this layer (it sits after
# `COPY apps/api`, so any source edit re-runs it). That metadata lives in pnpm's
# separate cache dir, so it gets its own cache mount; otherwise each source-only
# rebuild re-downloads it.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=pnpm-metadata,target=/pnpm/cache \
    pnpm --filter api deploy --prod --ignore-scripts /prod/api

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
# The official standalone pnpm distribution includes node-gyp. Copy it whole,
# matching the preparation stage's glibc; no package manager enters runtime.
FROM ghcr.io/pnpm/pnpm:12.15.0@sha256:d6148daf3ad2af8fa4ecd1aa06db73da32b2e37f63088987eea2fb375ee7f320 AS migrator-pnpm

# Share resolutions with the workspace, without running its build or hooks.
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS migrator-dependencies

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates perl-base libatomic1 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=migrator-pnpm /opt/pnpm /opt/pnpm
RUN ln -sf /opt/pnpm/pnpm /usr/local/bin/pnpm && test "$(pnpm --version)" = "12.15.0"
ENV pnpm_config_store_dir=/pnpm/store
ENV pnpm_config_cache_dir=/pnpm/cache
ENV pnpm_config_frozen_lockfile=true
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY docker/migrator/package.json ./docker/migrator/
# Suppress authoring hooks during install. Deploy runs only the locked CLI
# dependency scripts allowed by root policy, including the engine download.
RUN --mount=type=cache,id=migrator-pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=migrator-pnpm-metadata,target=/pnpm/cache \
    HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match install --prod --frozen-lockfile --ignore-scripts && \
    HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match deploy --prod /prod/migrator

# Do not inherit build tooling, installer caches, or the API dependency graph.
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS migrator

WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates perl-base tini && \
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=migrator-dependencies /prod/migrator/package.json ./package.json
COPY --from=migrator-dependencies /prod/migrator/node_modules ./node_modules
COPY apps/api/prisma.config.ts ./prisma.base.config.ts
COPY docker/migrator/prisma.config.mjs docker/migrator/connection-options.mjs ./
COPY docker/migrator/check-connection.sql ./migrator-check.sql
COPY apps/api/prisma ./prisma
USER node
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "docker-entrypoint.sh"]
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ===========================================
# Runner — minimal, self-contained, non-root
# ===========================================
# Deliberately NOT `FROM base`: the runner must not inherit Corepack/pnpm. The
# container only runs `node dist/main.js`, so pnpm is never invoked at runtime.
# Shipping Corepack's bundled pnpm would also
# drag its vulnerable bundled `undici` into the image (CVE-2026-12151) and bloat
# the attack surface for no runtime benefit.
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner

WORKDIR /app

ENV NODE_ENV=production

# TLS clients (S3, email providers, OAuth, HTTPS webhooks) need the system CA
# bundle; the Rust-free Prisma client no longer needs a bundled query engine.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates perl-base && \
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

# GeoIP database directory (worker writes, api reads read-only), owned by the
# non-root runtime user. A named Docker volume mounted here on first run
# copies this directory's ownership from the image, so both services can use
# it without a root init step; without this, an empty volume defaults to
# root:root and the worker's downloader fails with EACCES.
RUN mkdir -p /data/geoip /app/uploads && chown nestjs:nodejs /data/geoip /app/uploads

USER nestjs

EXPOSE 5002

CMD ["node", "dist/main.js"]
