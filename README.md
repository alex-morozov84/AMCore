# AMCore

[Managed local development, prepared previews and browser tests](docs/operations/local-stands.md). Agents use managed commands for local DB writes and previews.

> Production-oriented NestJS application starter for secure, modular products.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alex-morozov84/AMCore/badge)](https://scorecard.dev/viewer/?uri=github.com/alex-morozov84/AMCore)

## Overview

AMCore is a backend-first starter for SaaS products, internal tools and AI-enabled
applications. It combines a NestJS API, a Next.js frontend and shared TypeScript
contracts in one pnpm workspace.

The API includes authentication, organizations, scoped API keys, storage, media,
notifications, background work and AI capabilities. The frontend provides localized
sign-in flows, shared UI, theming and reusable organization administration.
Product-specific screens and business rules belong to your product.

The optional [Operations Console](docs/operations-console/README.md) serves
platform operators with `SUPER_ADMIN` access. It is separate from
[product administration](docs/product-admin/README.md).
[Operator MFA](docs/auth/mfa-browser.md) needs separately approved
[deployment and recovery](docs/auth/mfa-deployment.md).

**Creating a product?** Start with [Create and update a product](docs/operations/updating-a-fork.md).
No supported starting release exists yet; older tags and this branch's Quick Start
are not a supported product base. The Quick Start below runs the starter for evaluation.

Start with [Quick Start](#quick-start), or use the [documentation map](docs/README.md)
to find a specific task.

Production deployment requires your own infrastructure, secrets, endpoint checks
and release approval. The included guides and templates do not certify your target.

## Backend Starter Capabilities

| Capability        | Status          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth & RBAC**   | ✅ Shipped      | Email auth, OAuth/OIDC, sessions, organizations, CASL permissions, admin flows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Access hints**  | ✅ Foundational | Implemented-action catalogue, validated permission presets, current-actor and actual-organization record/field hints for downstream UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **API Keys**      | ✅ Shipped      | Long-lived scoped server-to-server tokens with hashed secrets and org permission checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Storage**       | ✅ Shipped      | S3-compatible, local, and memory drivers with private-by-default uploads and download seams                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Media**         | ✅ Foundational | Safe image derivatives via `sharp`/libvips; avatar upload/delete is the shipped consumer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Notifications** | ✅ Shipped      | In-app feed, preferences, durable email + Telegram dispatch, realtime SSE fan-out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **AI Capability** | ✅ Foundational | Provider-agnostic assistants, runs, tools/approvals, takeover, multimodal inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **i18n**          | ✅ Shipped      | English + Russian end to end: locale-routed UI, per-user locale, ICU-pluralized email, API errors and form validation localized by machine-readable code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Operations**    | ✅ Shipped      | Health, Prometheus metrics + an optional Grafana/Alertmanager monitoring harness with shipped alert rules and per-category runbooks, an opt-in Alloy + Loki + Grafana log-search overlay (one `correlationId` finds a request and its worker jobs), a CI contract verifying the metric↔alert↔dashboard↔runbook chain stays correct (static + live checks against a real stack), audit log, idempotency, webhooks, TLS/reverse-proxy (incl. an optional bundled Caddy edge profile), Redis-backed GCRA rate limiting with burst tolerance, verified BFF client-identity relay, Postgres and local-files backup/restore + restore-drill rehearsal, production database role separation, secret rotation runbook, a build-once/promote-by-digest production deploy profile, a platform decision matrix (Kubernetes, Cloud Run, Fly, Render, Railway, Vercel), CI/security automation |

### Frontend Starter Capabilities

| Capability                            | Status          | Description                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture (FSD)**                | ✅ Shipped      | Thin App Router, Feature-Sliced Design layer boundaries, lint-enforced import and server/client rules                                                                                                                                                                                                                                                          |
| **Styling guardrails**                | ✅ Shipped      | Semantic design tokens as the only styling API — raw Tailwind palette/hex colors and the inline `style` prop fail lint; CSS Modules validated by Stylelint under the same token-only rule                                                                                                                                                                      |
| **Theming**                           | ✅ Shipped      | Light/dark/system modes, no-flash boot script, downstream rebrand tooling (`pnpm init:brand`)                                                                                                                                                                                                                                                                  |
| **Accessibility (a11y)**              | ✅ Shipped      | Solid token-pair contrast tests, browser checks of destructive-button normal/hover states, real-page WCAG A/AA scans including retained Sessions refetch, and CI-gating Storybook a11y checks                                                                                                                                                                  |
| **i18n (web)**                        | ✅ Shipped      | `next-intl` locale routing (`/en`, `/ru`), API/form errors localized by machine-readable code (never raw backend `message`), ICU plurals via `useLocalizedForm()`                                                                                                                                                                                              |
| **Auth & sessions**                   | ✅ Shipped      | BFF/Token-Handler pattern, full email/password reference flow (login, register, forgot/reset, email verification), OAuth, active-sessions screen and personal API-key settings                                                                                                                                                                                 |
| **Organization access**               | ✅ Foundational | Read-only selected overview with verified team-access status; headless context includes actor and actual-record hints, role editing is the separate Roles tab                                                                                                                                                                                                  |
| **Product administration foundation** | ✅ Foundational | Explicit organization creation with safe recovery, selector, read-only overview and one-placement headless integration; member list, atomic multi-role assignment, invitations, member-key management, confirmed member removal, a custom role editor and own-key creation; product-domain screens remain downstream-owned                                     |
| **Shared UI**                         | ✅ Shipped      | shadcn/Base UI primitives kept to AMCore's lint/i18n/token contract, a Sidebar app shell                                                                                                                                                                                                                                                                       |
| **Route progress bar**                | ✅ Shipped      | First-party (no dependency) top navigation-progress indicator, reduced-motion aware, toggleable via a documented dev/agent-facing flag                                                                                                                                                                                                                         |
| **Component workshop**                | ✅ Shipped      | Storybook wired to the same MSW/theme/i18n stack as the real app; every story doubles as a Vitest test with a CI-gating axe check                                                                                                                                                                                                                              |
| **Browser security**                  | ✅ Shipped      | Security-header baseline, nonce-based Content Security Policy (enforced in production by default), a minimal violation-reporting endpoint                                                                                                                                                                                                                      |
| **Search-engine indexing**            | ✅ Shipped      | Closed to search engines by default and opened per environment with two run-time variables; metadata, sitemap and robots helpers for the pages you choose to make public                                                                                                                                                                                       |
| **Testing pyramid**                   | ✅ Shipped      | Vitest + MSW, Playwright mocked/server-mocked/real-stack lanes proving auth/BFF/cookies/Redis end to end                                                                                                                                                                                                                                                       |
| **BFF API consumption**               | ✅ Foundational | Documented hooks for media, notifications, and AI through the BFF; shared `EventSource` realtime pattern; `429`/`Retry-After` retry policy                                                                                                                                                                                                                     |
| **Operations Console**                | ✅ Shipped      | Optional `SUPER_ADMIN` control plane with Overview, Background work diagnostics and policy-eligible controls, Scheduled jobs results, Integrations state and test email, user and organization detail pages, Users sign-in setup, verification/recovery mail, role changes and session revocation, approximate IP location, Audit browsing, path/host sessions |
| **Bundle budget**                     | ✅ Foundational | Per-route first-load JavaScript limits checked in CI after every web build; the check fails closed on incomplete build measurements                                                                                                                                                                                                                            |

### Product Modules

Start with [product administration adoption](docs/product-admin/adoption.md) to
choose ready pages or custom UI. Read [placement and sessions](docs/product-admin/placement-and-sessions.md)
before choosing path or host login. Then use the
[integration guide](docs/product-admin/integration.md) for your composition.
The [feature reference](docs/product-admin/README.md) covers organizations, members,
roles, invitations and API keys. Add your domain modules downstream.

## Tech Stack

| Layer             | Technology                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| **Backend**       | NestJS 12 + Fastify 5, PostgreSQL 18, Prisma 7, Redis, BullMQ                  |
| **Auth**          | JWT + Refresh Tokens, OAuth 2.0 / OIDC, API Keys                               |
| **Email**         | Resend, vendored React Email primitives + `@react-email/render`, FormatJS i18n |
| **Storage**       | S3-compatible storage, local production/development driver, memory test driver |
| **Frontend**      | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui + Base UI                      |
| **i18n**          | next-intl (web) + FormatJS (email), ICU MessageFormat, CLDR plurals            |
| **Architecture**  | Feature-Sliced Design (FSD)                                                    |
| **Monorepo**      | pnpm workspaces + Turborepo                                                    |
| **Testing**       | Jest 30, Vitest 5, MSW 2, Playwright 1.62, axe-core, Testcontainers            |
| **Observability** | Prometheus, Grafana, Alertmanager (optional dev-only monitoring profile)       |

## Project Structure

```text
apps/api/       NestJS API and worker
apps/web/       Next.js frontend
packages/shared/  Shared schemas, types and configuration
docs/           Task guides and references
docker/         Deployment and recovery configuration
scripts/        Repository and operator tools
```

Root also carries `docker-compose.yml` (the reference full stack) and
`docker/compose/prod.yml` (the production image-pull overlay applied on top of
it) — see [Going to production](#going-to-production).

## What's Built

The backend starter includes the core application, security, and operations
primitives needed for a product-grade API. Production deployment still requires
adopter-owned infrastructure, secrets, environments, and capacity choices.

| Area                                                         | Start here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All docs by intent                                           | [`docs/README.md`](docs/README.md) — the documentation map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Backend architecture                                         | [`apps/api/README.md`](apps/api/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Frontend architecture                                        | [`docs/frontend/architecture-and-conventions.md`](docs/frontend/architecture-and-conventions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Frontend testing                                             | [`docs/frontend/testing.md`](docs/frontend/testing.md) — Vitest/MSW, Storybook, Playwright mocked/server-mocked/real-stack lanes, and automated a11y scans                                                                                                                                                                                                                                                                                                                                                                                                       |
| Storybook                                                    | [`docs/frontend/storybook.md`](docs/frontend/storybook.md) — component workshop, story conventions, a11y gate, and maintenance procedures                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Route bundle budgets                                         | [`docs/frontend/bundle-budget.md`](docs/frontend/bundle-budget.md) — per-page first-load JavaScript limits, the CI check and how to change a limit                                                                                                                                                                                                                                                                                                                                                                                                               |
| Production operations                                        | [`docs/operations/`](docs/operations/README.md) — deployment, observability, CI security                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Observability / metrics & alerting                           | [`docs/operations/observability.md`](docs/operations/observability.md) — Prometheus metric families, an optional Grafana/Alertmanager dev harness, shipped alert rules with an off-by-default SLO burn-rate layer, per-category [runbooks](docs/operations/runbooks/), a safe extension recipe, and a static + live CI contract that proves the metric↔alert↔dashboard↔runbook chain stays correct                                                                                                                                                               |
| API surface                                                  | Swagger/OpenAPI at `/docs` in development, including JWT/API-key bearer schemes, multipart uploads, and CI-guarded success-response inventory                                                                                                                                                                                                                                                                                                                                                                                                                    |

Tests use Jest + SWC for backend unit tests and API E2E suites with Testcontainers.
API build requires type checking before SWC emission; unit tests do not check types.
See [API build and ESM runtime](docs/backend/api-build.md) for module boundaries and commands.
Vitest runs `packages/shared`'s own schema/lib contract tests, React Email
template rendering, and frontend unit/integration tests. Storybook covers
isolated component-state/interaction/a11y checks. Playwright runs frontend
browser flows, with `@axe-core/playwright` for automated accessibility scans.
See [`docs/backend/architecture-and-conventions.md`](docs/backend/architecture-and-conventions.md#2-contract-shared-zod)
for where a shared schema's own test belongs, and
[`docs/frontend/testing.md`](docs/frontend/testing.md) for the frontend test
taxonomy and command choices.

For first-company setup, use the [organization establishment guide](docs/product-admin/organization-establishment.md).
It covers a shop's internal organization, public self-service companies, closed
signup, Console-disabled installations and recovery after lost responses.

## Quick Start

Install Docker with Compose v2.20.2 or newer, Git and OpenSSL.
The Docker build supplies its own Node and pnpm; host installation is not required.

Use a fresh checkout and disposable local PostgreSQL/Redis instances. The commands
can write to the selected database; Docker runs migrations automatically.
Review `.env` and active profiles first. Keep `DATABASE_URL`/`REDIS_URL` and
`COMPOSE_DATABASE_URL`/`COMPOSE_REDIS_URL` pointed at those disposable local services.
Do not use production, a retained database or another checkout's resources.
These manual commands do not enforce isolation; agents use
[managed local development](docs/operations/local-stands.md).

The bundled `amcore` database credentials are local-development values, not an
application login or production credentials. Review the [environment example](.env.example)
and supply the generated shared web/API proof below. Use the
[first organization and administrator guide](docs/product-admin/organization-establishment.md)
for guarded seed, account setup and registration policies; a listening stack alone
is not that result. Never copy the development credentials into production.

```bash
# Prerequisites: Git, Docker (Compose v2.20.2+), OpenSSL

git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
cp .env.example .env          # COMPOSE_PROFILES=local-infra is the default
# For the Docker command below, use the same confidential proof in web and API.
export WEB_FRONTEND_CONTEXT_KEY="$(openssl rand -hex 32)"
```

**Run the full stack in Docker** (bundled Postgres + Redis, schema migrated for you):

```bash
FRONTEND_URL=http://localhost:3000 WEB_TRUSTED_ORIGINS=http://localhost:3000 docker compose up
# API: http://localhost:5002 · Swagger: http://localhost:5002/docs · Web: http://localhost:3000
```

**Host development:** use [managed local development](docs/operations/local-stands.md)
for an isolated development environment. Agents must use that workflow for database
writes and previews.

For host package commands, use Node 24 from `.nvmrc` with the minimum patch in
`package.json` (currently 24.15.0) and its exact `packageManager` pnpm version
(currently 12.18.0). Check both versions before installing frozen dependencies.

For manual native development, configure only disposable local services and
use the same API/web proof exported above. With the bundled PostgreSQL, set
`DATABASE_URL="postgresql://amcore:amcore@localhost:5432/amcore?schema=public"`
in root `.env` before migrating.

```bash
# Migrate only a disposable local development database.
pnpm install --frozen-lockfile &&
docker compose up -d postgres redis &&
pnpm --filter api db:migrate &&
export REDIS_URL="redis://localhost:6379" &&
pnpm dev
```

The API reads root `.env`; exported values override it. Web does not read that
file, so export `WEB_FRONTEND_CONTEXT_KEY` and `REDIS_URL` in the shell running
`pnpm dev`. Strict Turbo passes those and `FRONTEND_URL`, `PRODUCT_ADMIN_ORIGIN`,
`WEB_TRUSTED_ORIGINS`; it builds shared before dependent dev processes.
Native web listens on port 3002. `FRONTEND_URL` and `WEB_TRUSTED_ORIGINS` must
name the address where you open web (normally `http://localhost:3002`), not the
Docker web address above. Export changed origin settings so API and web agree.
Without a key, web refuses startup. With mismatched keys or missing web Redis
configuration, startup can succeed but session bootstrap returns 503. A listening
process is not working authentication. For separate package starts, follow
[API development](docs/backend/api-build.md#development).

> Production uses `prisma migrate deploy` from the CLI-capable migrator image as
> a one-shot step before rolling out the slim app image — never `db:migrate`
> (which is `migrate dev`). For a managed/VPS database and Redis, set
> `COMPOSE_PROFILES=` empty plus `COMPOSE_DATABASE_URL` / `COMPOSE_REDIS_URL`
> in `.env`. File storage is a separate choice: configure S3, or explicitly use
> `STORAGE_DRIVER=local` with a persistent volume shared by API and worker. See
> [`docs/operations/deployment.md`](docs/operations/deployment.md).

> **Building a product from this starter?** Run `pnpm init:brand` (product
> identity, logo/icons, theme) — see
> [`docs/frontend/brand-theme-and-tokens.md` → Fork initialization](docs/frontend/brand-theme-and-tokens.md#fork-initialization).
> `init:brand` updates [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) from
> `upstream-starter` to `downstream-product` when you provide a product
> name, and records the product identity, upstream-sync policy, and workflow
> mode (`strict`, `flexible`, or `custom`) from the corresponding prompts or
> flags. Which languages the product serves and how the Operations Console is
> served (off, a path, or its own host) are two settings files, not prompts: see
> [`PROJECT_CONTEXT.md` → Build Settings](PROJECT_CONTEXT.md#build-settings). Console
> hostnames are deployment configuration (`ADMIN_CONSOLE_HOSTNAME`). Still set by hand: where the
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

To add product management screens, start with the [product administration
integration guide](docs/product-admin/integration.md). The Console setting in `packages/shared/src/config/admin-console.json`
configures only the separate `SUPER_ADMIN` Operations Console; it does not
create product administration pages or choose their placement.

If startup fails, retain the first error and stop before retrying migrations or
changing database state. Check [API development](docs/backend/api-build.md#development)
and the [deployment guide](docs/operations/deployment.md). A listening process
alone does not prove sign-in, email delivery or organization setup.
Use [first organization and administrator](docs/product-admin/organization-establishment.md)
when you need those accounts and policies.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Going to production

Use [Lighthouse audits](docs/frontend/testing.md#lighthouse-audits) to inspect loaded pages and individual accessibility defects.
[Open complete HTML reports](docs/frontend/testing.md#find-and-open-lighthouse-reports) from local indexes or CI artifacts.

The Quick Start is for local evaluation. For one production server, follow
[Single-host production](docs/operations/single-host-compose.md). For another
platform, use the [platform decision guide](docs/operations/deployment-platforms.md).

The [operations index](docs/operations/README.md) routes deployment, migrations,
role separation, backups, recovery and secret rotation. The
[production deploy profile](docs/operations/production-deploy-profile.md) defines
artifact promotion; its workflow template requires an adopter implementation.
Production remains closed to indexing until you deliberately configure
[search-engine indexing](docs/frontend/seo.md).

## Help and contributions

Use the [documentation map](docs/README.md) for task instructions and
[GitHub issues](https://github.com/alex-morozov84/AMCore/issues) for reproducible bugs.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
Report vulnerabilities privately through [SECURITY.md](SECURITY.md), not public issues.

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)

