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

- **Format:** `type(scope): subject` — **a scope is required** (commitlint blocks a missing scope).
- **Subject:** lowercase, no period at the end, max 72 characters.
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes:** `api`, `web`, `shared`, `auth`, `fitness`, `finance`, `subscriptions`, `ci`, `docs`, `deps`.

Examples:

```
feat(auth): add google oauth login
fix(web): correct button disabled state
docs: update quick start env step
chore: unify github repository url
```

## Branching & merging

- `main` and `develop` are **protected — PR-only**; a direct push is rejected.
  Branch off `develop` and open a PR into `develop`. Releases are a PR
  `develop → main`.
- Required CI checks must pass before merge. Merge with **Squash** or **Rebase**
  only — both branches require linear history (no merge commits). Feature PRs into
  `develop` may use either; **release PRs (`develop → main`) merge with Squash** so
  already-released commits are not replayed.
- First-time repo-protection setup (these settings do not travel with a fork):
  `bash scripts/setup-repo-security.sh` — needs `gh` + `jq` and repo admin; see
  [`docs/operations/ci-security.md`](docs/operations/ci-security.md). The security
  scripts require a Unix-like shell (macOS/Linux/WSL).

## Before Submitting a PR

1. Run `pnpm lint` and `pnpm typecheck` — must pass.
2. Run `pnpm test` — all tests must pass.
3. Run `pnpm format:check` — or `pnpm format` to fix.
4. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and ensure the checklist is satisfied.

CI runs the same checks on push; fixing any failures before opening a PR saves time.

## Troubleshooting

- **`pnpm --filter web build` hangs at "Creating an optimized production build…"** —
  this is a stuck `next build` process holding `apps/web/.next/lock`, not a dependency
  problem. Kill the stale process and remove the lock:
  ```bash
  rm -f apps/web/.next/lock
  ```
  then re-run the build. Don't bisect dependencies for this symptom.
