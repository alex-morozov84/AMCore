# ===========================================
# Stage 1: Dependencies
# ===========================================
# Debian slim (glibc), not Alpine (musl): the API depends on `sharp`/libvips for
# media processing. Slim ships sharp's prebuilt glibc binary with bundled libvips
# out of the box and matches the glibc CI runners, so production native loading is
# reproducible. A CI-gated smoke test (.github/workflows/ci.yml) verifies a real
# sharp WebP encode inside the built runner image.
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ===========================================
# Stage 2: Builder
# ===========================================
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# Copy deps
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/typescript-config/node_modules ./packages/typescript-config/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy source
COPY packages/typescript-config ./packages/typescript-config
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Build shared package
RUN pnpm --filter @amcore/shared build

# Generate Prisma client
RUN pnpm --filter api prisma:generate

# Build API
RUN pnpm --filter api build

# ===========================================
# Stage 3: Production
# ===========================================
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user (Debian: groupadd/useradd)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nestjs

# Copy built application
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

USER nestjs

EXPOSE 5002

CMD ["node", "dist/main.js"]
