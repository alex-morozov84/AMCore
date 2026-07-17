# AMCore Documentation

The documentation map. The root [`README.md`](../README.md) is the project
overview and quick start; **this page routes you to the right guide by intent**.
Endpoint shapes (paths, request/response bodies, status codes) are **not** kept
here — the Swagger/OpenAPI document at `/docs` in development is their source of
truth. These guides cover the model, extension points, and invariants OpenAPI
does not express.

## Find the right guide

| I want to…                                       | Go to                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Add a backend module the AMCore way              | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md) |
| Configure auth, OAuth, sessions                  | [`auth/`](auth/README.md)                                                            |
| Set up RBAC / authorization                      | [`auth/rbac.md`](auth/rbac.md)                                                       |
| Issue scoped API keys                            | [`auth/api-keys.md`](auth/api-keys.md)                                               |
| Add or customize email                           | [`email/`](email/README.md)                                                          |
| Add a notification                               | [`notifications/`](notifications/README.md)                                          |
| Add an AI provider / tool / assistant / artifact | [`ai/`](ai/README.md)                                                                |
| Add a storage- or media-backed feature           | [`storage/`](storage/README.md), [`media/`](media/README.md)                         |
| Deploy, run, or operate the system               | [`operations/`](operations/README.md)                                                |
| Understand the CI / repo-security workflow       | [`operations/ci-security.md`](operations/ci-security.md)                             |

## Documentation map

- **[Backend architecture & conventions](backend/architecture-and-conventions.md)** —
  how to add a backend module: Prisma, shared contracts, NestJS wiring, auth,
  process roles, and required tests.
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
  roles, observability, CI/repo security, audit log, webhooks, and idempotency.

## Common extension tasks

Each links to the "how to add X" section in its guide — the instructions live
there, not here.

- Add a backend module → [Backend architecture & conventions](backend/architecture-and-conventions.md)
- Add an OAuth provider → [Auth · OAuth](auth/oauth.md#adding-a-new-provider)
- Add a notification definition → [Notifications · Add a notification definition](notifications/README.md#add-a-notification-definition)
- Add an AI tool + approval policy → [AI · Add a Tool](ai/tools-and-approvals.md#add-a-tool)
- Add an AI provider / model → [AI · Add or Change a Model](ai/providers.md#add-or-change-a-model)
- Add an assistant version → [AI · Publish a New Version](ai/assistants.md#publish-a-new-version)
- Add an artifact-backed run input → [AI · Upload and Use an Artifact](ai/artifacts.md#upload-and-use-an-artifact)
- Add an email template → [Email · Add a Template](email/templates.md#add-a-template)
- Add an audited action → [Operations · Add an audited action](operations/audit-log.md#add-an-audited-action)
- Add a metric → [Operations · Add a metric](operations/observability.md#add-a-metric)
