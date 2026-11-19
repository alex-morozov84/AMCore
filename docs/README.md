# AMCore Documentation

[Local development, previews and browser tests](operations/local-stands.md). Agents use managed commands for local DB writes and previews.

The documentation map. The root [`README.md`](../README.md) is the project
overview and quick start; **this page routes you to the right guide by intent**.
Writing or updating a guide? Follow the [documentation writing guide](documentation-guide.md).
Endpoint shapes (paths, request/response bodies, status codes) are **not** kept
here — the Swagger/OpenAPI document at `/docs` in development is their source of
truth. These guides cover the model, extension points, and invariants OpenAPI
does not express.

For a first production deployment, start with the
[operations index](operations/README.md) and its single-host or platform path.

`ADR-NNN` citations identify maintainer decision records that are not distributed
with this checkout. Required rules must be stated in the public guide or source
comment. If a rule is available only through an unavailable record, report the gap.

## Find the right guide

[Add product administration to your product](product-admin/adoption.md) — shop, CRM/ERP and SaaS recipes, initialization and your own interface.
[Create a company or prepare its first administrator](product-admin/organization-establishment.md) — policies, Console/CLI/API setup and recovery.
[Create an organization and invite its administrator](product-admin/organization-provisioning.md) — Console, protected API, mail readiness and recovery.

| I want to…                                                                               | Go to                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Store or extend typed ordinary runtime settings                                          | [`backend/settings.md`](backend/settings.md)                                                                                            |
| Validate API requests and filter typed responses                                         | [`backend/schema-validation.md`](backend/schema-validation.md)                                                                          |
| Extend or operate the API HTTP runtime                                                   | [`backend/http-runtime.md`](backend/http-runtime.md) — Fastify plugins, upgrade checks and rollback.                                    |
| Understand request parsing, decoded limits and transport errors                          | [`backend/request-body-contract.md`](backend/request-body-contract.md)                                                                  |
| Build, develop or extend the ESM API                                                     | [`backend/api-build.md`](backend/api-build.md)                                                                                          |
| Build the migration image or recover an interrupted migration                            | [`operations/migrator-image.md`](operations/migrator-image.md)                                                                          |
| Build or verify shared package distribution                                              | [`backend/shared-package-build.md`](backend/shared-package-build.md)                                                                    |
| Add a backend module the AMCore way                                                      | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md)                                                    |
| Register background work, an idempotent handler or a database-owned control adapter      | [`backend/background-work.md`](backend/background-work.md)                                                                              |
| Add a periodic (cron/interval) job that shows its result in the Console                  | [`backend/scheduled-jobs.md`](backend/scheduled-jobs.md)                                                                                |
| Register an outside service in the backend status API                                    | [`backend/integrations.md`](backend/integrations.md)                                                                                    |
| Add a route/page on the frontend the AMCore way                                          | [`frontend/architecture-and-conventions.md`](frontend/architecture-and-conventions.md#the-recipe--adding-a-route)                       |
| Add local or URL-backed frontend search                                                  | [`frontend/search/README.md`](frontend/search/README.md)                                                                                |
| Know which import/styling rules are enforced                                             | [`frontend/fsd-boundaries-and-guardrails.md`](frontend/fsd-boundaries-and-guardrails.md)                                                |
| Reuse or add a shared UI primitive (shadcn)                                              | [`frontend/shared-ui-and-shadcn.md`](frontend/shared-ui-and-shadcn.md)                                                                  |
| Choose data ownership or consume media/notifications/AI                                  | [`frontend/api-consumption.md`](frontend/api-consumption.md)                                                                            |
| Add a third-party script/style origin, or run CSP in report-only                         | [`frontend/browser-security-and-csp.md`](frontend/browser-security-and-csp.md)                                                          |
| Make a page indexable by search engines, or keep the product closed to them              | [`frontend/seo.md`](frontend/seo.md)                                                                                                    |
| Add a frontend test / pick the right layer                                               | [`frontend/testing.md`](frontend/testing.md)                                                                                            |
| Write or review a Storybook story                                                        | [`frontend/storybook.md`](frontend/storybook.md)                                                                                        |
| Initialize a downstream fork (rebrand, theme, icons)                                     | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#fork-initialization)                                          |
| Find recorded service problems and open their diagnostic source                          | [`operations-console/overview.md`](operations-console/overview.md#find-what-needs-checking)                                             |
| Diagnose and safely control background work (or open the read-only queue board)          | [`operations-console/background-work.md`](operations-console/background-work.md), [`queue-board.md`](operations-console/queue-board.md) |
| Check that nightly cleanups, the GeoIP update and recovery passes keep running           | [`operations-console/scheduled-jobs.md`](operations-console/scheduled-jobs.md)                                                          |
| See which outside services are set up, and send a test email to yourself                 | [`operations-console/integrations.md`](operations-console/integrations.md)                                                              |
| Send account verification or password recovery mail                                      | [`operations-console/users.md#help-someone-sign-in`](operations-console/users.md#help-someone-sign-in)                                  |
| Find out whether the workers can reach Telegram with the bot token, or alert on it       | [`operations/runbooks/telegram.md`](operations/runbooks/telegram.md)                                                                    |
| Use, configure, deploy, or safely extend Operations Console                              | [`operations-console/`](operations-console/README.md)                                                                                   |
| Check or update the per-route frontend bundle budgets                                    | [`frontend/bundle-budget.md`](frontend/bundle-budget.md)                                                                                |
| Add a navigating Link / programmatic navigation, or configure the route-progress bar     | [`frontend/route-progress.md`](frontend/route-progress.md)                                                                              |
| Add an environment variable                                                              | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-environment-variable)                     |
| Learn how the shared Redis client is configured and what its timeouts do not bound       | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md)                                                    |
| Add an external service / infra dependency                                               | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-external-service--infra-dependency)       |
| Add UI copy, a locale, or an error message                                               | [`frontend/i18n-and-errors.md`](frontend/i18n-and-errors.md)                                                                            |
| Choose which languages your product serves, or turn the Console off or move it           | [`PROJECT_CONTEXT.md` → Build Settings](../PROJECT_CONTEXT.md#build-settings)                                                           |
| Configure auth, OAuth, sessions                                                          | [`auth/`](auth/README.md)                                                                                                               |
| Deploy, recover and maintain operator MFA                                                | [`auth/mfa-deployment.md`](auth/mfa-deployment.md)                                                                                      |
| Set up RBAC / authorization                                                              | [`auth/rbac.md`](auth/rbac.md)                                                                                                          |
| Understand authentication when Redis is slow or down (`503`, deadlines, recovery)        | [`auth/redis-outage.md`](auth/redis-outage.md)                                                                                          |
| Discover implemented actions, author permission presets, or add a resource               | [`auth/capability-catalogue.md`](auth/capability-catalogue.md)                                                                          |
| Integrate product administration pages or custom headless UI                             | [Product administration foundation](product-admin/README.md)                                                                            |
| Use or mount the product organization UI                                                 | [`frontend/organization-context.md`](frontend/organization-context.md)                                                                  |
| Select or extend organization context                                                    | [`auth/organization-context.md`](auth/organization-context.md)                                                                          |
| Upgrade installed organization permissions                                               | [`auth/authorization-upgrade.md`](auth/authorization-upgrade.md)                                                                        |
| Inspect/revoke platform API keys                                                         | [`operations-console/api-keys.md`](operations-console/api-keys.md)                                                                      |
| Issue scoped API keys                                                                    | [My API keys](product-admin/own-api-keys.md) / [bearer API](auth/api-keys.md)                                                           |
| Add or customize email                                                                   | [`email/`](email/README.md)                                                                                                             |
| Add a notification                                                                       | [`notifications/`](notifications/README.md)                                                                                             |
| Control notification deliveries and preserve provider evidence                           | [`notifications/control.md`](notifications/control.md)                                                                                  |
| Add an AI provider / tool / assistant / artifact                                         | [`ai/`](ai/README.md)                                                                                                                   |
| Add a storage- or media-backed feature                                                   | [`storage/`](storage/README.md), [`media/`](media/README.md)                                                                            |
| Set up a storage provider (Yandex, AWS, R2, ...) or check it works                       | [`storage/providers/`](storage/providers/README.md), [`storage/testing.md`](storage/testing.md)                                         |
| Fix a storage problem (403 on a public file, CORS, presigned URLs)                       | [`storage/troubleshooting.md`](storage/troubleshooting.md)                                                                              |
| Deploy, run, or operate the system                                                       | [`operations/`](operations/README.md)                                                                                                   |
| Deploy to one server with Docker Compose (TLS database, HTTPS edge, restart policies)    | [`operations/single-host-compose.md`](operations/single-host-compose.md)                                                                |
| Size a host, or read measured throughput and memory                                      | [`operations/capacity.md`](operations/capacity.md)                                                                                      |
| Repeat the reference load measurement on a disposable host                               | [`operations/load-testing.md`](operations/load-testing.md)                                                                              |
| Set up TLS / a reverse proxy                                                             | [`operations/deployment.md`](operations/deployment.md#tls--reverse-proxy)                                                               |
| Run the Prometheus/Grafana/Alertmanager monitoring harness, or respond to an alert       | [`operations/observability.md`](operations/observability.md), [`operations/runbooks/`](operations/runbooks/)                            |
| Search application logs by request ID, or install the Alloy + Loki log-search overlay    | [`operations/log-search.md`](operations/log-search.md), [`operations/runbooks/log-shipping.md`](operations/runbooks/log-shipping.md)    |
| Add or change an alert, dashboard panel, runbook, or Alertmanager receiver               | [`operations/observability.md`](operations/observability.md#change-or-extend-observability)                                             |
| Understand or override route rate limits                                                 | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#cross-cutting-decision-points)                      |
| Let the global limiter tell BFF visitors apart                                           | [`operations/deployment.md`](operations/deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy)       |
| Understand frontend retry behavior for `429`                                             | [`frontend/api-consumption.md`](frontend/api-consumption.md#retry-policy-429-and-retry-after-adr-073)                                   |
| Set up a registry-based production deploy (digest promotion, environments)               | [`operations/production-deploy-profile.md`](operations/production-deploy-profile.md)                                                    |
| Stop obsolete browser timers after a web deployment                                      | [Open-tab recovery](operations/deployment.md#open-tabs-after-a-web-deployment)                                                          |
| Roll out a new version by digest, with restart policies and bounded logs                 | [`operations/deployment.md`](operations/deployment.md#production-rollout-via-registry-image-pull-path)                                  |
| Roll out with minimal downtime (health-gated restart, blue-green)                        | [`operations/deployment.md`](operations/deployment.md#zerolow-downtime-rollout--stated-honestly)                                        |
| Back up or restore database data and local files                                         | [`operations/backup-restore.md`](operations/backup-restore.md)                                                                          |
| Set up production database role separation                                               | [`operations/database-role-separation.md`](operations/database-role-separation.md)                                                      |
| Move an existing deployment to a new PostgreSQL major version                            | [`operations/postgresql-major-upgrade.md`](operations/postgresql-major-upgrade.md)                                                      |
| Rotate `JWT_SECRET`, DB/Redis credentials, OAuth secrets, or API keys                    | [`operations/secret-rotation.md`](operations/secret-rotation.md)                                                                        |
| Decide which platform to deploy AMCore on (K8s, Cloud Run, Fly, Render, Railway, Vercel) | [`operations/deployment-platforms.md`](operations/deployment-platforms.md)                                                              |
| Understand the CI / repo-security workflow                                               | [`operations/ci-security.md`](operations/ci-security.md)                                                                                |
| Review staged file/function sizes before a PR                                            | [`CONTRIBUTING.md` → Size review advisory](../CONTRIBUTING.md#size-review-advisory)                                                     |

For session management, see [own and admin API contracts](auth/sessions.md) and
[approximate-location setup and operation](operations/geoip-setup.md).

The optional [Console actions](operations-console/users.md#manage-sessions)
provide an operator interface for admin session management.

Create or update a downstream product: [fork update guide](operations/updating-a-fork.md).
It covers repository choice, release support, merge delivery and recovery.

## Documentation map

- **[Backend architecture & conventions](backend/architecture-and-conventions.md)** —
  how to add a backend module: Prisma, shared contracts, NestJS wiring, auth,
  process roles, and required tests.
- [Frontend architecture & conventions](frontend/architecture-and-conventions.md).
- [Frontend search](frontend/search/README.md).
- [Boundaries & guardrails](frontend/fsd-boundaries-and-guardrails.md).
- [Brand, theme, and design tokens](frontend/brand-theme-and-tokens.md).
- [Shared UI & shadcn](frontend/shared-ui-and-shadcn.md).
- [i18n & error localization](frontend/i18n-and-errors.md).
- [Frontend API consumption](frontend/api-consumption.md).
- [Browser security headers and CSP](frontend/browser-security-and-csp.md).
- [Search-engine indexing](frontend/seo.md).
- **[Lighthouse audits](frontend/testing.md#lighthouse-audits)** — local production audits, downloadable HTML reports, complete page inventory and safe evidence.
- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, Storybook, and axe scans), the technical boundary the E2E
  split is drawn on, and the tool-neutral runtime-verification workflow.
- **[Storybook](frontend/storybook.md)** — the `shared/ui`/feature-flow
  component workshop: decorators, story conventions, the accessibility
  gate, and the CLI-safety/`optimizeDeps.include` procedures.
- **[Route bundle budgets](frontend/bundle-budget.md)** — the CI check
  that limits each page's first-load JavaScript, how to investigate a
  failure and how to change a limit.
- [Top route progress bar](frontend/route-progress.md).
- [Product administration foundation](product-admin/README.md), [role definitions API and ready Roles tab](product-admin/role-definitions.md), [member access explanation](product-admin/member-access.md), [confirmed member removal](product-admin/organization-members.md#remove-a-member), [member API-key control](product-admin/member-api-keys.md), [account menu, profile and avatar](product-admin/account-menu-and-profile.md), [invitations](product-admin/invitations.md).
- [Operations Console](operations-console/README.md).
- [Auth](auth/README.md), [RBAC](auth/rbac.md), [capability catalogue and access
  hints](auth/capability-catalogue.md), [API keys](auth/api-keys.md), [invitations](auth/invites.md), [auth contracts reference](auth/reference.md).
- [Email](email/README.md), [welcome policy upgrade](email/queued-upgrade.md).
- [Notifications](notifications/README.md).
- [AI capability layer](ai/README.md).
- [Storage](storage/README.md), [Media](media/README.md).
- **[Operations](operations/README.md)** — deployment, migrations, process
  roles, TLS/reverse-proxy setup (nginx or the optional bundled Caddy
  profile), the production deploy profile (build-once/promote-by-digest,
  GitHub Environments), the `docker/compose/prod.yml` image-pull production
  overlay (immutable digests, restart policies, log rotation), Postgres
  backup/restore, PostgreSQL major-version upgrades, production database
  role separation, secret rotation,
  the deployment platforms decision matrix (Kubernetes, Cloud Run, Fly,
  Render, Railway, Vercel), observability, CI/repo security, audit log,
  webhooks, and idempotency.

## Common extension tasks

Each links to the "how to add X" section in its guide — the instructions live
there, not here.

- Add a backend module → [Backend architecture & conventions](backend/architecture-and-conventions.md)
- Register background work → [Backend background-work recipes](backend/background-work.md)
- Add a route/page → [Frontend architecture & conventions · The recipe](frontend/architecture-and-conventions.md#the-recipe--adding-a-route)
- Add search → [Frontend search](frontend/search/README.md)
- Add an environment variable → [Backend architecture & conventions · Adding an environment variable](backend/architecture-and-conventions.md#adding-an-environment-variable)
- Add an external service / infra dependency → [Backend architecture & conventions · Adding an external service / infra dependency](backend/architecture-and-conventions.md#adding-an-external-service--infra-dependency)
- Add an OAuth provider → [Auth · OAuth](auth/oauth.md#adding-a-new-provider)
- Add a notification definition → [Notifications · Add a notification definition](notifications/README.md#add-a-notification-definition)
- Version or replay notifications → [Notification versioning](notifications/versioning.md)
- Register a notification channel → [Channel composition](notifications/channels.md)
- Add an AI tool + approval policy → [AI · Register a tool](ai/tools-and-approvals.md#register-a-tool)
- Add an AI provider / model → [AI · Add or Change a Model](ai/providers.md#add-or-change-a-model)
- Add an assistant version → [AI · Publish a New Version](ai/assistants.md#publish-a-new-version)
- Add an artifact-backed run input → [AI · Upload and Use an Artifact](ai/artifacts.md#upload-and-use-an-artifact)
- Add an email template → [Email · Add a Template](email/templates.md#add-a-template)
- Add UI copy or a translation → [i18n · Add a UI string](frontend/i18n-and-errors.md#recipe-add-a-ui-string)
- Add a backend error code end to end → [i18n · Add a backend error code](frontend/i18n-and-errors.md#recipe-add-a-backend-error-code-end-to-end)
- Add a locale → [i18n · Add a third locale](frontend/i18n-and-errors.md#recipe-add-a-third-locale)
- Add an audited action → [Operations · Add an audited action](operations/audit-log.md#add-an-audited-action)
- Add a metric → [Operations · Add a metric](operations/observability.md#add-a-metric)
- Add or change an alert, dashboard panel, runbook, or receiver → [Operations · Change or extend observability](operations/observability.md#change-or-extend-observability)

[Place product administration and isolate host sessions](product-admin/placement-and-sessions.md) — configurable path alias, canonical addresses, login/logout boundaries and deployment.

## Help and contributions

Read [CONTRIBUTING.md](../CONTRIBUTING.md) before contributing.
Use [GitHub issues](https://github.com/alex-morozov84/AMCore/issues) for reproducible bugs.
Report vulnerabilities privately through [SECURITY.md](../SECURITY.md).
See the root README for [author](../README.md#author) and [license](../README.md#license).
