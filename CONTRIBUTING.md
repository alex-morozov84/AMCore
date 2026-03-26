# Contributing to AMCore

Thanks for your interest in contributing. This document explains how to set up the project and submit changes.

## Getting Started

1. **Clone and install** — See [README → Quick Start](README.md#quick-start) for prerequisites, clone, `pnpm install`, Docker, and migrations.
2. **Environment** — Copy `.env.example` to `.env` (root) and `apps/web/.env.example` to `apps/web/.env.local`.
3. **Run locally** — `pnpm dev` starts API and web in development mode.

## Development Commands

| Command             | Description                |
| ------------------- | -------------------------- |
| `pnpm dev`          | Start all apps in dev mode |
| `pnpm build`        | Build all apps             |
| `pnpm lint`         | Run ESLint                 |
| `pnpm typecheck`    | Run TypeScript check       |
| `pnpm test`         | Run all unit tests         |
| `pnpm format:check` | Check Prettier formatting  |
| `pnpm format`       | Format code with Prettier  |

Single app: `pnpm --filter api dev`, `pnpm --filter web test`, etc.

### API-specific test commands

| Command                                           | Description                                      |
| ------------------------------------------------- | ------------------------------------------------ |
| `pnpm --filter api test`                          | All unit tests                                   |
| `pnpm --filter api test -- path/to/file.spec.ts`  | Single test file                                 |
| `pnpm --filter api test:e2e`                      | All E2E tests (requires Docker — Testcontainers) |
| `pnpm --filter api test:e2e -- oauth.e2e-spec.ts` | Single E2E suite                                 |
| `pnpm --filter api test:email`                    | Email template integration tests (Vitest)        |

> **Note:** Never use `npx jest` directly for E2E tests — the `test:e2e` script sets `NODE_OPTIONS='--experimental-vm-modules'` required for ESM packages.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) and commitlint.

- **Format:** `type(scope): subject` — scope is optional.
- **Subject:** lowercase, no period at the end, max 72 characters.
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes (optional):** `api`, `web`, `shared`, `auth`, `fitness`, `finance`, `subscriptions`, `ci`, `docs`, `deps`.

Examples:

```
feat(auth): add google oauth login
fix(web): correct button disabled state
docs: update quick start env step
chore: unify github repository url
```

## Before Submitting a PR

1. Run `pnpm lint` and `pnpm typecheck` — must pass.
2. Run `pnpm test` — all tests must pass.
3. Run `pnpm format:check` — or `pnpm format` to fix.
4. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and ensure the checklist is satisfied.

CI runs the same checks on push; fixing any failures before opening a PR saves time.
