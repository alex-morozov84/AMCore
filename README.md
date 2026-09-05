# AMCore

> Production-oriented NestJS application starter for secure, modular products.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alex-morozov84/AMCore/badge)](https://scorecard.dev/viewer/?uri=github.com/alex-morozov84/AMCore)

## Overview

AMCore is a production-oriented application starter for building secure, modular
SaaS products, internal tools, and AI-enabled systems. The reusable surface is
backend-first: a NestJS API foundation with strong application and security
primitives, broad tests, and a completed production-readiness baseline,
including a documented [production deploy
profile](docs/operations/production-deploy-profile.md) (build-once/
promote-by-digest, staging/production GitHub Environments). Specific hosting
targets and CD credentials remain adopter-specific.

The repository also contains a Next.js frontend/admin starter workspace. It now
ships the frontend foundations a downstream product should inherit rather than
recreate: locale-routed UI, localized API/form errors, design tokens with
light/dark/system theme support, FSD boundaries, lint-enforced styling
guardrails, a shadcn/Base UI Sidebar app shell, BFF/Token-Handler auth with
the full email/password reference flow (login, register, forgot/reset
password, email verification/resend) plus an active-sessions screen, and
documented hooks for consuming media, notifications, and AI through the BFF.
Feature-specific admin surfaces remain intentionally product-owned.

### Backend Starter Capabilities

| Capability        | Status          | Description                                                                                                                                                                                                                                                          |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth & RBAC**   | ✅ Shipped      | Email auth, OAuth/OIDC, sessions, organizations, CASL permissions, admin flows                                                                                                                                                                                       |
| **API Keys**      | ✅ Shipped      | Long-lived scoped server-to-server tokens with hashed secrets and org permission checks                                                                                                                                                                              |
| **Storage**       | ✅ Shipped      | S3-compatible, local, and memory drivers with private-by-default uploads and download seams                                                                                                                                                                          |
| **Media**         | ✅ Foundational | Safe image derivatives via `sharp`/libvips; avatar upload/delete is the shipped consumer                                                                                                                                                                             |
| **Notifications** | ✅ Shipped      | In-app feed, preferences, durable email + Telegram dispatch, realtime SSE fan-out                                                                                                                                                                                    |
| **AI Capability** | ✅ Foundational | Provider-agnostic assistants, runs, tools/approvals, takeover, multimodal inputs                                                                                                                                                                                     |
| **i18n**          | ✅ Shipped      | English + Russian end to end: locale-routed UI, per-user locale, ICU-pluralized email, API errors and form validation localized by machine-readable code                                                                                                             |
| **Operations**    | ✅ Shipped      | Health, observability, audit log, idempotency, webhooks, TLS/reverse-proxy (incl. an optional bundled Caddy edge profile), Redis-backed GCRA rate limiting with burst tolerance, verified BFF client-identity relay, Postgres backup/restore, CI/security automation |

### Frontend Starter Capabilities

| Capability               | Status          | Description                                                                                                                                                                                 |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture (FSD)**   | ✅ Shipped      | Thin App Router, Feature-Sliced Design layer boundaries, lint-enforced import and server/client rules                                                                                       |
| **Styling guardrails**   | ✅ Shipped      | Semantic design tokens as the only styling API — raw Tailwind palette/hex colors and the inline `style` prop fail ESLint; CSS Modules validated by Stylelint under the same token-only rule |
| **Theming**              | ✅ Shipped      | Light/dark/system modes, no-flash boot script, downstream rebrand tooling (`pnpm init:brand`)                                                                                               |
| **Accessibility (a11y)** | ✅ Shipped      | WCAG AA contrast enforced by a dependency-free test on the shipped token CSS, `@axe-core/playwright` WCAG A/AA scans on real pages, and a CI-gating Storybook a11y check per component      |
| **i18n (web)**           | ✅ Shipped      | `next-intl` locale routing (`/en`, `/ru`), API/form errors localized by machine-readable code (never raw backend `message`), ICU plurals via `useLocalizedForm()`                           |
| **Auth & sessions**      | ✅ Shipped      | BFF/Token-Handler pattern, full email/password reference flow (login, register, forgot/reset, email verification), OAuth, active-sessions screen                                            |
| **Shared UI**            | ✅ Shipped      | shadcn/Base UI primitives kept to AMCore's lint/i18n/token contract, a Sidebar app shell                                                                                                    |
| **Component workshop**   | ✅ Shipped      | Storybook wired to the same MSW/theme/i18n stack as the real app; every story doubles as a Vitest test with a CI-gating axe check                                                           |
| **Browser security**     | ✅ Shipped      | Security-header baseline, nonce-based Content Security Policy (enforced in production by default), a minimal violation-reporting endpoint                                                   |
| **Testing pyramid**      | ✅ Shipped      | Vitest + MSW, Playwright mocked/server-mocked/real-stack lanes proving auth/BFF/cookies/Redis end to end                                                                                    |
| **BFF API consumption**  | ✅ Foundational | Documented hooks for media, notifications, and AI through the BFF; shared `EventSource` realtime pattern; `429`/`Retry-After` retry policy                                                  |
| **Bundle budget**        | ✅ Foundational | Documented per-route client bundle baseline (Turbopack analyzer) with a non-vacuity proof; CI enforcement deliberately deferred with a concrete reopening trigger                           |

### Product Modules

Product-specific modules are intentionally left to downstream applications.
Forks can add their own bounded areas on top of the starter's reusable
capabilities without inheriting an unrelated sample domain.

## Tech Stack

| Layer            | Technology                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| **Backend**      | NestJS 11, PostgreSQL 16, Prisma 7, Redis, BullMQ                              |
| **Auth**         | JWT + Refresh Tokens, OAuth 2.0 / OIDC, API Keys                               |
| **Email**        | Resend, vendored React Email primitives + `@react-email/render`, FormatJS i18n |
| **Storage**      | S3-compatible storage, local dev driver, memory test driver                    |
| **Frontend**     | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui + Base UI                      |
| **i18n**         | next-intl (web) + FormatJS (email), ICU MessageFormat, CLDR plurals            |
| **Architecture** | Feature-Sliced Design (FSD)                                                    |
| **Monorepo**     | pnpm workspaces + Turborepo                                                    |
| **Testing**      | Jest 30, Vitest 4, MSW 2, Playwright 1.62, axe-core, Testcontainers            |

## Project Structure

```
amcore/
├── apps/
│   ├── api/        # NestJS backend — see apps/api/README.md
│   └── web/        # Next.js frontend (FSD)
├── packages/
│   ├── shared/     # Zod schemas, types, constants (used by api + web)
│   ├── eslint-config/
│   └── typescript-config/
├── docs/
│   ├── backend/        # Backend module boundaries and extension conventions
│   ├── frontend/       # Frontend architecture, i18n, theme, and guardrails
│   ├── auth/           # Authentication & authorization documentation
│   ├── ai/             # AI capability layer (assistants, runs, tools, artifacts, providers, security)
│   ├── email/          # Email extension contract (templates, queueing, secret-bearing sends)
│   ├── notifications/  # Notifications subsystem (in-app feed, durable email & Telegram dispatch, realtime SSE, preferences)
│   ├── media/          # Image derivative/media processing documentation
│   ├── operations/     # Deployment, observability, security, and production runbooks
│   └── storage/        # File storage documentation
├── docker/         # Caddy edge profile, Postgres backup/restore scripts
├── scripts/        # Fork init (init:brand/init:project), repo-security setup, dependency-freshness
└── .github/        # CI, Dependabot, issue/PR templates
```

## What's Built

The backend starter includes the core application, security, and operations
primitives needed for a product-grade API. Production deployment still requires
adopter-owned infrastructure, secrets, environments, and capacity choices.

| Area                                | Start here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All docs by intent                  | [`docs/README.md`](docs/README.md) — the documentation map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Backend architecture                | [`apps/api/README.md`](apps/api/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Add a backend module                | [`docs/backend/architecture-and-conventions.md`](docs/backend/architecture-and-conventions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Frontend architecture               | [`docs/frontend/architecture-and-conventions.md`](docs/frontend/architecture-and-conventions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Frontend guardrails                 | [`docs/frontend/fsd-boundaries-and-guardrails.md`](docs/frontend/fsd-boundaries-and-guardrails.md) — layer/import rules, token-only styling and the banned inline `style` prop, CSS Modules                                                                                                                                                                                                                                                                                                                                                                      |
| Theming, design tokens & contrast   | [`docs/frontend/brand-theme-and-tokens.md`](docs/frontend/brand-theme-and-tokens.md) — token architecture, light/dark/system modes, the automated WCAG AA contrast test, and the downstream rebrand checklist                                                                                                                                                                                                                                                                                                                                                    |
| Shared UI and shadcn                | [`docs/frontend/shared-ui-and-shadcn.md`](docs/frontend/shared-ui-and-shadcn.md) — reusing `shared/ui`, safely adding shadcn primitives, adapting generated output to the lint/i18n/token contract                                                                                                                                                                                                                                                                                                                                                               |
| Frontend testing                    | [`docs/frontend/testing.md`](docs/frontend/testing.md) — Vitest/MSW, Storybook, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                                                                                                                                                                                                                                                                                                                                                                                                       |
| Storybook                           | [`docs/frontend/storybook.md`](docs/frontend/storybook.md) — component workshop, story conventions, a11y gate, and maintenance procedures                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Bundle baseline and budget          | [`docs/frontend/bundle-budget.md`](docs/frontend/bundle-budget.md) — per-route client bundle methodology, the current baseline, and why CI enforcement is deferred                                                                                                                                                                                                                                                                                                                                                                                               |
| Add an env variable                 | [`docs/backend/architecture-and-conventions.md#adding-an-environment-variable`](docs/backend/architecture-and-conventions.md#adding-an-environment-variable)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Auth, OAuth, sessions               | [`docs/auth/`](docs/auth/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| RBAC / authorization                | [`docs/auth/rbac.md`](docs/auth/rbac.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Email                               | [`docs/email/`](docs/email/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| i18n & error copy                   | [`docs/frontend/i18n-and-errors.md`](docs/frontend/i18n-and-errors.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Notifications                       | [`docs/notifications/`](docs/notifications/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AI capability layer                 | [`docs/ai/`](docs/ai/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Storage and media                   | [`docs/storage/`](docs/storage/README.md), [`docs/media/`](docs/media/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Frontend BFF API consumption        | [`docs/frontend/api-consumption.md`](docs/frontend/api-consumption.md) — the hooks that consume media/notifications/AI through the BFF, the shared `EventSource` realtime pattern, and the frontend retry policy                                                                                                                                                                                                                                                                                                                                                 |
| Production operations               | [`docs/operations/`](docs/operations/README.md) — deployment, observability, CI security                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Production deploy profile           | [`docs/operations/production-deploy-profile.md`](docs/operations/production-deploy-profile.md) — build-once/promote-by-digest contract, `staging`/`production` GitHub Environments setup, and the secrets/variables checklist                                                                                                                                                                                                                                                                                                                                    |
| VPS/Compose production overlay      | [`docs/operations/deployment.md`](docs/operations/deployment.md#production-rollout-via-registry-image-pull-path) — `docker-compose.prod.yml`: immutable digest pinning, restart policies, bounded/rotating logs, and honest zero/low-downtime rollout guidance                                                                                                                                                                                                                                                                                                   |
| TLS / reverse proxy                 | [`docs/operations/deployment.md`](docs/operations/deployment.md) — bring-your-own proxy (nginx example) or the optional bundled Caddy `edge` compose profile                                                                                                                                                                                                                                                                                                                                                                                                     |
| Rate limiting / BFF client identity | [`docs/backend/architecture-and-conventions.md#cross-cutting-decision-points`](docs/backend/architecture-and-conventions.md#cross-cutting-decision-points), [`docs/operations/deployment.md`](docs/operations/deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy), [`docs/frontend/api-consumption.md`](docs/frontend/api-consumption.md#retry-policy-429-and-retry-after-adr-073) — Redis-backed GCRA global rate limiting with burst tolerance, opt-in verified BFF client-IP relay, and frontend `Retry-After` handling |
| Browser security headers / CSP      | [`docs/frontend/browser-security-and-csp.md`](docs/frontend/browser-security-and-csp.md) — static header baseline, nonce-based CSP, enforcement mode, HSTS, adding a third-party origin, downstream route-scoping, and the CSP violation-reporting endpoint                                                                                                                                                                                                                                                                                                      |
| Backup & restore                    | [`docs/operations/backup-restore.md`](docs/operations/backup-restore.md) — managed-provider PITR, self-hosted WAL archiving, the bundled compose `backup`/`restore` profiles, and the `restore-drill` profile that rehearses an actual restore                                                                                                                                                                                                                                                                                                                   |
| API surface                         | Swagger/OpenAPI at `/docs` in development, including JWT/API-key bearer schemes, multipart uploads, and CI-guarded success-response inventory                                                                                                                                                                                                                                                                                                                                                                                                                    |

Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
Vitest for `packages/shared`'s own schema/lib contract tests, React Email
template rendering, and frontend unit/integration tests, Storybook for
isolated component-state/interaction/a11y checks, Playwright for frontend
browser flows, and `@axe-core/playwright` for automated accessibility scans.
See [`docs/backend/architecture-and-conventions.md`](docs/backend/architecture-and-conventions.md#2-contract-shared-zod)
for where a shared schema's own test belongs, and
[`docs/frontend/testing.md`](docs/frontend/testing.md) for the frontend test
taxonomy and command choices.

## Quick Start

```bash
# Prerequisites: Node.js 24.15+, pnpm 11+, Docker (Compose v2.20.2+)

git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
cp .env.example .env          # COMPOSE_PROFILES=local-infra is the default
```

**Option A — full stack in Docker** (bundled Postgres + Redis, schema migrated for you):

```bash
docker compose up             # one-shot `migrate` runs, then API + web start
# API: http://localhost:5002 · Swagger: http://localhost:5002/docs · Web: http://localhost:3000
```

**Option B — run the app on the host** (hot reload):

```bash
pnpm install
docker compose up -d postgres redis   # or point DATABASE_URL/REDIS_URL at your own
pnpm --filter api db:migrate          # prisma migrate dev (LOCAL development only)
pnpm dev
```

> Production uses `prisma migrate deploy` from the CLI-capable migrator image as
> a one-shot step before rolling out the slim app image — never `db:migrate`
> (which is `migrate dev`). To run the Docker stack against a managed/VPS DB or
> real S3, set `COMPOSE_PROFILES=` empty plus `COMPOSE_DATABASE_URL` /
> `COMPOSE_REDIS_URL` (and the S3 vars) in `.env`. See
> [`docs/operations/deployment.md`](docs/operations/deployment.md).

> **Building a product from this starter?** Run `pnpm init:brand` (product
> identity, logo/icons, theme) and, if needed, the one-time, destructive
> `pnpm init:project` (single-locale and/or disabling Storybook) — see
> [`docs/frontend/brand-theme-and-tokens.md` → Project scaffolding](docs/frontend/brand-theme-and-tokens.md#project-scaffolding).
> `init:brand` updates [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) from
> `upstream-starter` to `downstream-product` when you provide a product
> name, and records the product identity, upstream-sync policy, and workflow
> mode (`strict`, `flexible`, or `custom`) from the corresponding prompts or
> flags. `init:project` records structural choices such as single-locale mode
> and Storybook removal. Still set by hand: where the
> roadmap/status/product-specific decisions live, and anything GitHub-side
> (branch protection, secrets, environments). Repository files _declare_ the
> technical policy; GitHub-side enforcement is separate external state. For
> `strict` mode, apply the supported settings with one command (`gh` + `jq` +
> repo admin): `bash scripts/setup-repo-security.sh`.
> `flexible` and `custom` forks may choose different repository
> protections, but should document their rules in `PROJECT_CONTEXT.md` or
> their contributor guide. Deployment environments and secrets are
> configured separately. See
> [`docs/operations/ci-security.md` → What a fork inherits](docs/operations/ci-security.md#what-a-fork-inherits-and-what-it-doesnt).

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
