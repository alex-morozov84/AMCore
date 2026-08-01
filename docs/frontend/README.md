# Frontend

`apps/web` is AMCore's Next.js frontend/admin starter. It is being brought up
to the same production-starter standard as `apps/api`: documented contracts,
enforceable conventions, and a test surface a cold agent can extend without
guessing.

## What's included

| Topic                                                           | What it covers                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Architecture & conventions](./architecture-and-conventions.md) | FSD layer boundaries, route thinness, Server/Client Component defaults, state model, and how the frontend consumes the backend |
| [Brand, theme, and design tokens](./brand-theme-and-tokens.md)  | Token architecture, light/dark/system modes, the no-flash mechanism, brand assets, and the downstream rebrand checklist        |
| [i18n and error localization](./i18n-and-errors.md)             | Where copy lives, adding strings/locales/error codes, plurals, form validation, and running a fork single-locale               |

More guides land here as later frontend/admin starter tracks complete
(FSD lint guardrails, shared UI, API client patterns, testing, Storybook) — see `architecture-and-conventions.md`'s "See also" section for
the current set.

## Start here

- Extending or adding a route/page → [Architecture & conventions](./architecture-and-conventions.md#the-recipe--adding-a-route)
- Adding copy, a locale, or an error message → [i18n and error localization](./i18n-and-errors.md)
- Backend endpoint shapes (paths, request/response bodies, status codes) →
  the Swagger/OpenAPI document at `/docs` in development, not this guide —
  see [Architecture & conventions § Relationship to backend/OpenAPI docs](./architecture-and-conventions.md#relationship-to-backendopenapi-docs)
- Rebranding a downstream fork (logo, PWA icons, tokens, theme mode) →
  [Brand, theme, and design tokens § Downstream rebrand checklist](./brand-theme-and-tokens.md#downstream-rebrand-checklist)
