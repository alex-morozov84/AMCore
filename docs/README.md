# AMCore Documentation

The documentation map. The root [`README.md`](../README.md) is the project
overview and quick start; **this page routes you to the right guide by intent**.
Endpoint shapes (paths, request/response bodies, status codes) are **not** kept
here — the Swagger/OpenAPI document at `/docs` in development is their source of
truth. These guides cover the model, extension points, and invariants OpenAPI
does not express.

## Find the right guide

| I want to…                                                                 | Go to                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Add a backend module the AMCore way                                        | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md)                                              |
| Add a route/page on the frontend the AMCore way                            | [`frontend/architecture-and-conventions.md`](frontend/architecture-and-conventions.md#the-recipe--adding-a-route)                 |
| Know which import/styling rules are enforced                               | [`frontend/fsd-boundaries-and-guardrails.md`](frontend/fsd-boundaries-and-guardrails.md)                                          |
| Reuse or add a shared UI primitive (shadcn)                                | [`frontend/shared-ui-and-shadcn.md`](frontend/shared-ui-and-shadcn.md)                                                            |
| Consume media/notifications/AI from the frontend                           | [`frontend/api-consumption.md`](frontend/api-consumption.md)                                                                      |
| Add a third-party script/style origin, or run CSP in report-only           | [`frontend/browser-security-and-csp.md`](frontend/browser-security-and-csp.md)                                                    |
| Add a frontend test / pick the right layer                                 | [`frontend/testing.md`](frontend/testing.md)                                                                                      |
| Write or review a Storybook story                                          | [`frontend/storybook.md`](frontend/storybook.md)                                                                                  |
| Initialize a downstream fork (rebrand, single-locale, disable Storybook)   | [`frontend/brand-theme-and-tokens.md`](frontend/brand-theme-and-tokens.md#project-scaffolding)                                    |
| Check or update the frontend bundle baseline                               | [`frontend/bundle-budget.md`](frontend/bundle-budget.md)                                                                          |
| Add an environment variable                                                | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-environment-variable)               |
| Add an external service / infra dependency                                 | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#adding-an-external-service--infra-dependency) |
| Add UI copy, a locale, or an error message                                 | [`frontend/i18n-and-errors.md`](frontend/i18n-and-errors.md)                                                                      |
| Configure auth, OAuth, sessions                                            | [`auth/`](auth/README.md)                                                                                                         |
| Set up RBAC / authorization                                                | [`auth/rbac.md`](auth/rbac.md)                                                                                                    |
| Issue scoped API keys                                                      | [`auth/api-keys.md`](auth/api-keys.md)                                                                                            |
| Add or customize email                                                     | [`email/`](email/README.md)                                                                                                       |
| Add a notification                                                         | [`notifications/`](notifications/README.md)                                                                                       |
| Add an AI provider / tool / assistant / artifact                           | [`ai/`](ai/README.md)                                                                                                             |
| Add a storage- or media-backed feature                                     | [`storage/`](storage/README.md), [`media/`](media/README.md)                                                                      |
| Deploy, run, or operate the system                                         | [`operations/`](operations/README.md)                                                                                             |
| Set up TLS / a reverse proxy                                               | [`operations/deployment.md`](operations/deployment.md#tls--reverse-proxy)                                                         |
| Understand or override route rate limits                                   | [`backend/architecture-and-conventions.md`](backend/architecture-and-conventions.md#cross-cutting-decision-points)                |
| Let the global limiter tell BFF visitors apart                             | [`operations/deployment.md`](operations/deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy) |
| Understand frontend retry behavior for `429`                               | [`frontend/api-consumption.md`](frontend/api-consumption.md#retry-policy-429-and-retry-after-adr-073)                             |
| Set up a registry-based production deploy (digest promotion, environments) | [`operations/production-deploy-profile.md`](operations/production-deploy-profile.md)                                              |
| Back up or restore the database                                            | [`operations/backup-restore.md`](operations/backup-restore.md)                                                                    |
| Set up production database role separation                                 | [`operations/database-role-separation.md`](operations/database-role-separation.md)                                                |
| Understand the CI / repo-security workflow                                 | [`operations/ci-security.md`](operations/ci-security.md)                                                                          |

## Documentation map

- **[Backend architecture & conventions](backend/architecture-and-conventions.md)** —
  how to add a backend module: Prisma, shared contracts, NestJS wiring, auth,
  process roles, and required tests.
- **[Frontend architecture & conventions](frontend/architecture-and-conventions.md)** —
  FSD layer boundaries, route thinness, Server/Client Component defaults,
  state model, and how the frontend consumes the backend.
- **[Boundaries & guardrails](frontend/fsd-boundaries-and-guardrails.md)** —
  what the layer, import, server/client and token rules are, which tool enforces
  each, what is deliberately not covered, and how to add a guard.
- **[Brand, theme, and design tokens](frontend/brand-theme-and-tokens.md)** —
  token architecture, light/dark/system modes, the no-flash mechanism, the
  downstream rebrand checklist, and initializing a fork with
  `pnpm init:brand` / `pnpm init:project`.
- **[Shared UI & shadcn](frontend/shared-ui-and-shadcn.md)** — the `shared/ui`
  reuse rule, the current primitive inventory, and the safe procedure for
  running the shadcn CLI (why a bare `shadcn add` against the live tree isn't
  safe).
- **[i18n & error localization](frontend/i18n-and-errors.md)** — where copy
  lives, adding strings/locales/error codes, ICU plurals, localized form
  validation, locale-prefixed links from the backend, and running a fork
  single-locale.
- **[Frontend API consumption](frontend/api-consumption.md)** — how `apps/web`
  hooks consume the media, notifications, and AI backend surfaces through the
  BFF, why the realtime hooks use native `EventSource` instead of the custom
  fetch-stream reader a direct (non-BFF) SSE consumer needs, the frontend
  `429`/`Retry-After` retry policy, and the opt-in client-IP relay that lets
  `apps/api`'s rate limiter tell BFF visitors apart.
- **[Browser security headers and CSP](frontend/browser-security-and-csp.md)** —
  the static header baseline, nonce-based CSP, enforcement mode, HSTS,
  adding a third-party origin, downstream route-scoping, and the CSP
  violation-reporting endpoint.
- **[Frontend testing](frontend/testing.md)** — the test taxonomy
  (Vitest unit/component, MSW integration, Playwright mocked/server-mocked/
  real-stack E2E, Storybook, and axe scans), the technical boundary the E2E
  split is drawn on, and the tool-neutral runtime-verification workflow.
- **[Storybook](frontend/storybook.md)** — the `shared/ui`/feature-flow
  component workshop: decorators, story conventions, the accessibility
  gate, and the CLI-safety/`optimizeDeps.include` procedures.
- **[Bundle baseline and budget](frontend/bundle-budget.md)** — the
  per-route client bundle size methodology, the current baseline, the
  non-vacuity proof, and why CI enforcement is deferred.
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
  profile), the production deploy profile (build-once/promote-by-digest,
  GitHub Environments), the `docker-compose.prod.yml` image-pull production
  overlay (immutable digests, restart policies, log rotation), Postgres
  backup/restore, production database role separation, observability,
  CI/repo security, audit log, webhooks, and idempotency.

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
