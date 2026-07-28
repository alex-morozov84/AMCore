# Frontend Architecture & Conventions

How `apps/web` is structured, and the rules that keep it that way. This guide
is about _decisions and boundaries_ — layers, routing, component defaults, and
state — not a re-explanation of Next.js, React, or TanStack Query themselves.
This page is the public frontend architecture contract.

For the tech stack and current package set, read
[`apps/web/package.json`](../../apps/web/package.json). For backend module
conventions, see [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md).

## Sources of truth

- **Cross-boundary contracts** (types, Zod schemas shared with `apps/api`)
  live in [`packages/shared`](../../packages/shared/src) — never duplicate a
  type that already exists there.
- **Endpoint shapes** (paths, request/response bodies, status codes, auth
  schemes) live in the Swagger/OpenAPI document at `/docs` in development —
  see [Relationship to backend/OpenAPI docs](#relationship-to-backendopenapi-docs).
  This guide does not re-document individual endpoints.

## Layers: Next App Router vs FSD

`apps/web` follows Feature-Sliced Design (FSD) on top of Next's App Router.
The two systems own different things, and the layer names say which:

| Path                   | Owns                                                                                                         | Notes                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`             | Next App Router files only: `page`, `layout`, `loading`, `error`, metadata, route handlers when truly needed | Thin — see [Route thinness](#route-thinness)                                                                                                                          |
| `src/_pages/`          | FSD Pages layer: page composition                                                                            | **Target name.** The current tree still uses `src/views/` for this layer — legacy starter drift, not yet migrated. Treat `views/` as `_pages/` until the rename lands |
| `src/_app/` (optional) | FSD App layer: app-level providers/config that live outside Next's own route files                           | Use only if app-level wiring doesn't fit naturally in `src/app/layout.tsx` / `providers.tsx`                                                                          |
| `src/widgets/`         | Composed UI blocks made of multiple features/entities                                                        | Canonical FSD meaning, unchanged                                                                                                                                      |
| `src/features/`        | Single user-interaction-driven slices (e.g. `auth/login`)                                                    | Canonical FSD meaning, unchanged                                                                                                                                      |
| `src/entities/`        | Business-domain data + its UI (e.g. `user`)                                                                  | Canonical FSD meaning, unchanged                                                                                                                                      |
| `src/shared/`          | Generic reusable code with no business meaning: UI primitives, API client, hooks, lib, store                 | Canonical FSD meaning, unchanged                                                                                                                                      |

The underscore prefix on `_pages`/`_app` exists so the FSD layer names don't
read as Next reserved directories — Next's own routing only ever looks inside
`src/app/`.

### Import rule: public API only

Import a slice through its `index.ts`, never a file inside it:

```ts
// Correct
import { LoginForm } from '@/features/auth/login'

// Wrong — reaches past the slice's public API
import { LoginForm } from '@/features/auth/login/ui/LoginForm'
```

Each slice folder's `index.ts` is the contract for what other layers may use.
Enforcing this with lint tooling (rather than convention alone) is Track 4
(FSD boundaries and agent guardrails) — until then, treat it as a hard rule in
review.

A layer may only import from layers below it in the table above (e.g.
`features` may import `entities`/`shared`, never the reverse, and never a
sibling `feature`'s internals).

## Route thinness

Files under `src/app/` handle **plumbing only**: metadata, route params,
`redirect`, `notFound`, and provider/layout wiring. They must not contain
business UI, direct feature/entity data hooks, substantial JSX, or
client-only state. Composition belongs in `_pages/` (today: `views/`):

```
src/app/(dashboard)/page.tsx        → imports and renders a _pages/ (views/) component
src/_pages/dashboard/DashboardPage.tsx → owns the actual composition
```

`src/app/(dashboard)/page.tsx` does not yet follow this rule — it's a known
gap left for Track 9 (starter cleanup), not fixed by the architecture
contract itself.

## Server/Client Component defaults

**Server Components are the default** for routes and page composition.
`'use client'` is pushed down to the leaf component that actually needs:

- interactivity (event handlers, form state);
- effects (`useEffect`, subscriptions);
- browser-only APIs;
- a Zustand store or a TanStack Query hook.

`app/providers.tsx` is the reference client boundary: everything above it
(`app/layout.tsx`) stays a Server Component (it can `await getLocale()` /
`getMessages()` directly), and the client-only providers (query client, auth
store, PWA) are isolated below that one boundary rather than marking the
whole tree client-side.

## State model

| Kind                                                        | Use            | Example                             |
| ----------------------------------------------------------- | -------------- | ----------------------------------- |
| **Server state** (data owned by the backend)                | TanStack Query | `entities/user/api/user-queries.ts` |
| **Local client state** (UI-only, not persisted server-side) | Zustand        | `shared/store/stores/ui.ts`         |

Don't duplicate server state into a Zustand store "for convenience" — that's
how the two fall out of sync. If a value needs to survive a page navigation
and isn't server data, it's a Zustand candidate; if it comes from the API,
it's a query.

## Relationship to backend/OpenAPI docs

`docs/frontend/` documents **consumption patterns** — how the frontend calls
the backend, maps errors, and structures query keys. It never re-documents
endpoint shapes; those live in the Swagger/OpenAPI document at `/docs`
(`apps/api/src/swagger.config.ts`), per `AGENTS.md`'s "OpenAPI is public
documentation" rule. When in doubt about a request/response shape, the
answer is `/docs` or the shared Zod schema in `packages/shared`, not this
guide.

### Browser API reach (target)

Browser-side calls should go through the same-origin Next rewrite proxy
(`next.config.ts` → `rewrites()`, `/api/:path*` → the backend) by default —
same-origin avoids a class of CORS/cookie problems for free, and Next already
configures the proxy. A direct backend base URL is reserved for server-side/
internal fetches (Server Components, Route Handlers) or an explicit,
documented deployment exception.

`apps/web/src/shared/api/client.ts` does not yet follow this: it builds a
direct cross-origin axios client against `NEXT_PUBLIC_API_URL`, whose default
port also disagrees with the proxy's default. This is a known implementation
gap, not fixed by this contract — it's in scope for Track 6 (API client,
auth, and query patterns), which should also reconcile the port mismatch in
`.env.example`.

## The recipe — adding a route

1. Add the route file under `src/app/` (`page.tsx`, `layout.tsx`, etc.) —
   metadata and plumbing only.
2. Build the actual page composition under `src/_pages/<route>/` (today:
   `src/views/<route>/`), importing whatever `widgets`/`features`/`entities`
   it needs through their public APIs.
3. If the route needs new server state, add a query (and query keys) in the
   owning `entities/` slice, following `entities/user/api/user-queries.ts`.
4. If the route needs new local UI state, add it to `shared/store` or a
   feature-local store — only promote it to `shared` if more than one feature
   needs it.
5. Decide Server vs Client for each new component per
   [Server/Client Component defaults](#serverclient-component-defaults)
   before defaulting to `'use client'`.
6. Add translations under `apps/web/messages/` (next-intl) — see Track 3 for
   the fuller i18n contract once it lands.
7. Update this guide's tables only if the route introduces a new pattern, not
   for routine additions.

## Downstream adoption

A downstream product forks `apps/web` **in place**: same repository layout,
same layer contract described in this guide. Branding, theme, and design
tokens (Track 2) replace assets, copy, and tokens — they do not change this
architectural structure.

## See also

- [Backend architecture & conventions](../backend/architecture-and-conventions.md) —
  the equivalent contract for `apps/api`.
- `AGENTS.md` → Code conventions — the condensed cross-tool version of the
  rules on this page.
- Later frontend/admin starter tracks add their own guide here as they land:
  brand/theme tokens, i18n and error localization, FSD lint guardrails,
  shared UI/shadcn baseline, API client/auth/query patterns, the testing
  pyramid, and Storybook.
