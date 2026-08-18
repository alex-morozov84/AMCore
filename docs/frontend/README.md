# Frontend

`apps/web` is AMCore's Next.js frontend/admin starter. It is being brought up
to the same production-starter standard as `apps/api`: documented contracts,
enforceable conventions, and a test surface a cold agent can extend without
guessing.

## What's included

| Topic                                                           | What it covers                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Architecture & conventions](./architecture-and-conventions.md) | FSD layer boundaries, route thinness, Server/Client Component defaults, state model, and how the frontend consumes the backend             |
| [Brand, theme, and design tokens](./brand-theme-and-tokens.md)  | Token architecture, light/dark/system modes, the no-flash mechanism, brand assets, and the downstream rebrand checklist                    |
| [i18n and error localization](./i18n-and-errors.md)             | Where copy lives, adding strings/locales/error codes, plurals, form validation, and running a fork single-locale                           |
| [Boundaries & guardrails](./fsd-boundaries-and-guardrails.md)   | Which layer, import, server/client and styling rules are enforced, by which tool, what is deliberately not covered, and how to add a guard |
| [Shared UI and shadcn](./shared-ui-and-shadcn.md)               | Reusing `shared/ui`, safely adding shadcn primitives, and adapting generated output to AMCore's lint/i18n/token contract                   |
| [API consumption](./api-consumption.md)                         | The hooks that consume media/notifications/AI through the BFF, and the `EventSource`-based realtime pattern shared by notifications and AI |
| [Testing](./testing.md)                                         | The frontend test taxonomy, Playwright mocked/server-mocked/real-stack lanes, accessibility scanning, and the tool-neutral dev loop        |
| [Storybook](./storybook.md)                                     | The component workshop: what's wired (a11y/theme/MSW/i18n decorators), story conventions, the CLI-safety and `optimizeDeps.include` rules  |

More guides land here as later frontend/admin starter tracks complete — see
`architecture-and-conventions.md`'s "See also" section for the current set.

## Start here

- Extending or adding a route/page → [Architecture & conventions](./architecture-and-conventions.md#the-recipe--adding-a-route)
- Adding copy, a locale, or an error message → [i18n and error localization](./i18n-and-errors.md)
- Reusing or adding a shared UI primitive → [Shared UI and shadcn](./shared-ui-and-shadcn.md)
- Writing or reviewing a `shared/ui`/feature-flow story → [Storybook](./storybook.md)
- Wondering whether an import or a colour is allowed → [Boundaries & guardrails](./fsd-boundaries-and-guardrails.md)
- Deciding between `'use client'`, `client-only` and `server-only` →
  [Boundaries & guardrails § Server/client boundaries](./fsd-boundaries-and-guardrails.md#serverclient-boundaries)
- Backend endpoint shapes (paths, request/response bodies, status codes) →
  the Swagger/OpenAPI document at `/docs` in development, not this guide —
  see [Architecture & conventions § Relationship to backend/OpenAPI docs](./architecture-and-conventions.md#relationship-to-backendopenapi-docs)
- Rebranding a downstream fork (logo, PWA icons, tokens, theme mode) →
  [Brand, theme, and design tokens § Downstream rebrand checklist](./brand-theme-and-tokens.md#downstream-rebrand-checklist)
