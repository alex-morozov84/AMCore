# AMCore Documentation

The documentation map. The root [`README.md`](../README.md) is the project
overview and quick start; **this page routes you to the right guide by intent**.
Endpoint shapes (paths, request/response bodies, status codes) are **not** kept
here — the Swagger/OpenAPI document at `/docs` in development is their source of
truth. These guides cover the model, extension points, and invariants OpenAPI
does not express.

## Find the right guide

| I want to…                                       | Go to                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Add a backend module the AMCore way              | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md)                                              |
| Add a route/page on the frontend the AMCore way  | [`frontend/architecture-and-conventions.md`](frontend/architecture-and-conventions.md#the-recipe--adding-a-route)                 |
| Add an environment variable                      | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-environment-variable)               |
| Add an external service / infra dependency       | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-external-service--infra-dependency) |
| Add UI copy, a locale, or an error message       | [`frontend/i18n-and-errors.md`](frontend/i18n-and-errors.md)                                                                      |
| Configure auth, OAuth, sessions                  | [`auth/`](auth/README.md)                                                                                                         |
| Set up RBAC / authorization                      | [`auth/rbac.md`](auth/rbac.md)                                                                                                    |
| Issue scoped API keys                            | [`auth/api-keys.md`](auth/api-keys.md)                                                                                            |
| Add or customize email                           | [`email/`](email/README.md)                                                                                                       |
| Add a notification                               | [`notifications/`](notifications/README.md)                                                                                       |
| Add an AI provider / tool / assistant / artifact | [`ai/`](ai/README.md)                                                                                                             |
| Add a storage- or media-backed feature           | [`storage/`](storage/README.md), [`media/`](media/README.md)                                                                      |
| Deploy, run, or operate the system               | [`operations/`](operations/README.md)                                                                                             |
| Set up TLS / a reverse proxy                     | [`operations/deployment.md`](operations/deployment.md#tls--reverse-proxy)                                                         |
| Back up or restore the database                  | [`operations/backup-restore.md`](operations/backup-restore.md)                                                                    |
| Understand the CI / repo-security workflow       | [`operations/ci-security.md`](operations/ci-security.md)                                                                          |

## Documentation map

- **[Backend architecture & conventions](backend/architecture-and-conventions.md)** —
  how to add a backend module: Prisma, shared contracts, NestJS wiring, auth,
  process roles, and required tests.
- **[Frontend architecture & conventions](frontend/architecture-and-conventions.md)** —
  FSD layer boundaries, route thinness, Server/Client Component defaults,
  state model, and how the frontend consumes the backend.
- **[i18n & error localization](frontend/i18n-and-errors.md)** — where copy
  lives, adding strings/locales/error codes, ICU plurals, localized form
  validation, locale-prefixed links from the backend, and running a fork
  single-locale.
- **[Auth](auth/README.md)** — authentication and authorization: concepts,
  sessions, OAuth, [RBAC](auth/rbac.md), [API keys](auth/api-keys.md), invites,
  CSRF, and the [auth contracts reference](auth/reference.md).
- **[Email](email/README.md)** — `EmailService` vs `NotificationsService`, React
  Email templates, delivery classes, and secret-link rules.
- **[Notifications](notifications/README.md)** — the per-user feed, preferences,
  durable email/Telegram channels, and the realtime SSE stream.
- **[AI capability layer](ai/README.md)** — conversations, durable runs,
  providers/models, assistants, tools/approvals, human takeover, and multimodal
  artifacts.
- **[Storage](storage/README.md)** & **[Media](media/README.md)** — the
  cloud-agnostic file layer and the image-derivative layer on top of it.
- **[Operations](operations/README.md)** — deployment, migrations, process
  roles, TLS/reverse-proxy setup (nginx or the optional bundled Caddy
  profile), Postgres backup/restore, observability, CI/repo security, audit
  log, webhooks, and idempotency.

## Common extension tasks

Each links to the "how to add X" section in its guide — the instructions live
there, not here.

- Add a backend module → [Backend architecture & conventions](backend/architecture-and-conventions.md)
- Add a route/page → [Frontend architecture & conventions · The recipe](frontend/architecture-and-conventions.md#the-recipe--adding-a-route)
- Add an environment variable → [Backend architecture & conventions · Adding an environment variable](backend/architecture-and-conventions.md#adding-an-environment-variable)
- Add an external service / infra dependency → [Backend architecture & conventions · Adding an external service / infra dependency](backend/architecture-and-conventions.md#adding-an-external-service--infra-dependency)
- Add an OAuth provider → [Auth · OAuth](auth/oauth.md#adding-a-new-provider)
- Add a notification definition → [Notifications · Add a notification definition](notifications/README.md#add-a-notification-definition)
- Add an AI tool + approval policy → [AI · Add a Tool](ai/tools-and-approvals.md#add-a-tool)
- Add an AI provider / model → [AI · Add or Change a Model](ai/providers.md#add-or-change-a-model)
- Add an assistant version → [AI · Publish a New Version](ai/assistants.md#publish-a-new-version)
- Add an artifact-backed run input → [AI · Upload and Use an Artifact](ai/artifacts.md#upload-and-use-an-artifact)
- Add an email template → [Email · Add a Template](email/templates.md#add-a-template)
- Add UI copy or a translation → [i18n · Add a UI string](frontend/i18n-and-errors.md#recipe-add-a-ui-string)
- Add a backend error code end to end → [i18n · Add a backend error code](frontend/i18n-and-errors.md#recipe-add-a-backend-error-code-end-to-end)
- Add a locale → [i18n · Add a third locale](frontend/i18n-and-errors.md#recipe-add-a-third-locale)
- Add an audited action → [Operations · Add an audited action](operations/audit-log.md#add-an-audited-action)
- Add a metric → [Operations · Add a metric](operations/observability.md#add-a-metric)
