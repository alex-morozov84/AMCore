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

- **Format:** `type(scope): subject`. **Scope is optional** — add it when the change maps to one clear area, and omit it for cross-cutting changes (e.g. `docs:`, `chore:`).
- **Subject:** lowercase, no period at the end, max 72 characters.
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes (when present):** `api`, `web`, `shared`, `auth`, `fitness`, `finance`, `subscriptions`, `ci`, `docs`, `deps`.

Examples:

```
feat(auth): add google oauth login
fix(web): correct button disabled state
docs: update quick start env step
chore: unify github repository url
```

## Branching & merging

- `main` is the **single protected trunk** (PR-only; a direct push is rejected).
  Branch off `main` (`<type>/<name>`) and open a PR into `main`. This is **GitHub
  Flow** — there is no long-lived `develop` branch.
- Required CI checks must pass before merge. **Merge with Squash** (linear history;
  one commit per PR). The **PR title becomes the squash commit message**, so it is
  linted as a Conventional Commit by CI.
- **Releases are tags.** Cut an annotated `vX.Y.Z` tag / GitHub Release from `main`;
  staging and production are promoted through deploy **environments**, not branches.
  To patch an older version, branch `release/x.y` from that tag when a backport is
  actually needed — no permanent `develop` required.
- First-time repo-protection setup (these settings do not travel with a fork):
  `bash scripts/setup-repo-security.sh` — needs `gh` + `jq` and repo admin; see
  [`docs/operations/ci-security.md` → What a fork inherits](docs/operations/ci-security.md#what-a-fork-inherits-and-what-it-doesnt). The security
  scripts require a Unix-like shell (macOS/Linux/WSL).

## Before Submitting a PR

1. Run `pnpm lint` and `pnpm typecheck` — must pass.
2. Run `pnpm test` — all tests must pass.
3. Run `pnpm format:check` — or `pnpm format` to fix.
4. Add notable user-facing changes to `CHANGELOG.md` under `[Unreleased]`. Skip
   internal refactors, tests, and typo-only documentation changes.
5. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and ensure the checklist is satisfied.

CI runs the same checks on push; fixing any failures before opening a PR saves time.

## Changelog & releases

Ordinary PRs do not bump the version or create tags. Maintainers release the
repository as one product; only the root `package.json` version is the release
version. Private workspace package versions stay unchanged.

Manual release procedure (until release automation is adopted):

1. Create a short-lived release-preparation branch from current `main`.
2. Choose the next SemVer version. Stay on `0.x` while the public starter
   contract is still evolving.
3. Set the root `package.json` version and move `[Unreleased]` entries in
   `CHANGELOG.md` into `[X.Y.Z] - YYYY-MM-DD`. Restore an empty `[Unreleased]`
   section and update the comparison links at the bottom.
4. Open a `chore: release vX.Y.Z` PR into `main`; merge it with Squash after CI.
5. Tag that exact `main` commit with annotated tag `vX.Y.Z`, push it, then create
   the matching GitHub Release.

Release tags are immutable: never move, overwrite, or delete an existing `v*`
tag. See the internal maintainer checklist in `ai/PROCESS.md` when `ai/` exists.

## Troubleshooting

- **`pnpm --filter web build` hangs at "Creating an optimized production build…"** —
  this is a stuck `next build` process holding `apps/web/.next/lock`, not a dependency
  problem. Kill the stale process and remove the lock:
  ```bash
  rm -f apps/web/.next/lock
  ```
  then re-run the build. Don't bisect dependencies for this symptom.
