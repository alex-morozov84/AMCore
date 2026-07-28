# Frontend

`apps/web` is AMCore's Next.js frontend/admin starter. It is being brought up
to the same production-starter standard as `apps/api`: documented contracts,
enforceable conventions, and a test surface a cold agent can extend without
guessing.

## What's included

| Topic                                                           | What it covers                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Architecture & conventions](./architecture-and-conventions.md) | FSD layer boundaries, route thinness, Server/Client Component defaults, state model, and how the frontend consumes the backend |

More guides land here as later frontend/admin starter tracks complete
(branding/theme, i18n, FSD lint guardrails, shared UI, API client patterns,
testing, Storybook) — see `architecture-and-conventions.md`'s "See also"
section for the current set.

## Start here

- Extending or adding a route/page → [Architecture & conventions](./architecture-and-conventions.md#the-recipe--adding-a-route)
- Backend endpoint shapes (paths, request/response bodies, status codes) →
  the Swagger/OpenAPI document at `/docs` in development, not this guide —
  see [Architecture & conventions § Relationship to backend/OpenAPI docs](./architecture-and-conventions.md#relationship-to-backendopenapi-docs)
