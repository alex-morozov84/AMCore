# ===========================================
# Base — pinned runtime + package manager
# ===========================================
# Node 24 + pnpm 11.1.2 to match the repo's engines/packageManager (the root
# package.json's `packageManager` drives the corepack version regardless of what
# is prepared here, so they must agree — a Node 20 base broke pnpm 11).
FROM node:24-alpine AS base

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# ===========================================
# Build — install (incl. dev) + build, one stage
# ===========================================
# A single stage avoids copying per-package `node_modules` across stages: pnpm
# does not create a `node_modules` for dependency-less workspace packages
# (e.g. packages/typescript-config), so the old cross-stage COPY failed. The
# install layer still caches because manifests are copied before sources.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm --filter @amcore/shared build

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# ===========================================
# Runner — minimal, self-contained, non-root
# ===========================================
FROM node:24-alpine AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next standalone output. With outputFileTracingRoot = repo root, the bundle is
# monorepo-rooted: the server entrypoint is at apps/web/server.js and the traced
# node_modules (incl. @amcore/shared) sit at the standalone root.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
