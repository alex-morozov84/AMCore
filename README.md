# AMCore

AMCore is a backend-first application starter for SaaS products, internal tools and AI applications. It combines a NestJS API and workers, a Next.js frontend and shared TypeScript contracts. You supply the product screens and business rules.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alex-morozov84/AMCore/badge)](https://scorecard.dev/viewer/?uri=github.com/alex-morozov84/AMCore)

| Capability | What you get |
| --- | --- |
| API and access | Authentication, organizations, permissions, scoped API keys and background jobs. |
| Product features | Avatar upload and deletion are built in. Use the [media tools](docs/media/README.md) to build your own gallery screens and workflows. The starter also provides storage, notifications and a foundation for AI assistants. |
| Frontend | Localized sign-in, organization administration, shared UI, themes and enforced import and styling rules. |
| Operations | An optional [Operations Console](docs/operations-console/README.md) for platform operators, plus guides for deployment, monitoring and recovery. Product administration has its [own integration guide](docs/product-admin/integration.md). |

**Creating a product?** Read [Create and update a product](docs/operations/updating-a-fork.md). No supported starting release exists yet. Use the checkout below for local evaluation.

## Quick Start

Install Git, OpenSSL and Docker with Compose v2.20.2 or newer. Docker supplies Node and pnpm.
For [manual host development](docs/backend/api-build.md#development), follow the native setup instead.
Agents use [managed local development](docs/operations/local-stands.md) for database writes and previews.

Use a fresh checkout and disposable local PostgreSQL and Redis. Compose runs migrations automatically.

```bash
git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
cp .env.example .env          # COMPOSE_PROFILES=local-infra is the default
```

For the bundled services, keep `COMPOSE_PROFILES=local-infra`. Leave `COMPOSE_DATABASE_URL`,
`COMPOSE_REDIS_URL` and `MIGRATION_DATABASE_URL` unset in both the shell and `.env`.
A migration URL can send migrations to a different database. Stop if the effective settings differ.

Generate the shared web/API key and start the stack only if generation succeeds:

```bash
WEB_FRONTEND_CONTEXT_KEY="$(openssl rand -hex 32)" &&
test -n "$WEB_FRONTEND_CONTEXT_KEY" &&
export WEB_FRONTEND_CONTEXT_KEY &&
FRONTEND_URL=http://localhost:3000 WEB_TRUSTED_ORIGINS=http://localhost:3000 docker compose up
# API: http://localhost:5002 · Swagger: http://localhost:5002/docs · Web: http://localhost:3000
```

If startup fails, keep the first error and stop before retrying migrations or changing database state.
Open [the web app](http://localhost:3000). Choose Register if public registration is enabled, or sign in with an existing application account.
The `amcore/amcore` credentials are for local PostgreSQL only. For organization setup, use the
[first organization and administrator guide](docs/product-admin/organization-establishment.md).

## Going to production

For one server, follow [Single-host production](docs/operations/single-host-compose.md).
For other platforms, use the [platform guide](docs/operations/deployment-platforms.md).
Supply your infrastructure, secrets and release checks. The [deployment template](docs/operations/production-deploy-profile.md)
requires your own deployment steps. Public indexing requires [explicit configuration](docs/frontend/seo.md).

## Documentation and support

Use the [documentation map](docs/README.md) to find a guide. See [CONTRIBUTING.md](CONTRIBUTING.md)
for development and contributions. Report bugs in [GitHub issues](https://github.com/alex-morozov84/AMCore/issues)
and vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
