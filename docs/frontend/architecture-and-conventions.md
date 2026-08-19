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
- **Framework-level Next.js APIs and behavior** (routing, caching, App Router
  conventions, config options) live in the version-matched docs bundled with
  the installed package at `apps/web/node_modules/next/dist/docs/`, not in
  this guide or in a model's training data. See the root `AGENTS.md` →
  _Next.js reference_ bullet for exactly when this applies and what's expected
  in a PR.

## Layers: Next App Router vs FSD

`apps/web` follows Feature-Sliced Design (FSD) on top of Next's App Router.
The two systems own different things, and the layer names say which:

| Path                   | Owns                                                                                                         | Notes                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`             | Next App Router files only: `page`, `layout`, `loading`, `error`, metadata, route handlers when truly needed | Thin — see [Route thinness](#route-thinness). Routes live under a `[locale]` segment — see [Locale routing](#locale-routing) |
| `src/i18n/`            | Locale routing config, locale-aware navigation helpers, request config, param validation                     | Import navigation from here, never from `next/link` / `next/navigation` — see [Locale routing](#locale-routing)              |
| `src/_pages/`          | FSD Pages layer: page composition                                                                            | Canonical FSD meaning, unchanged                                                                                             |
| `src/_app/` (optional) | FSD App layer: app-level providers/config that live outside Next's own route files                           | Use only if app-level wiring doesn't fit naturally in `src/app/layout.tsx` / `providers.tsx`                                 |
| `src/widgets/`         | Composed UI blocks made of multiple features/entities                                                        | Canonical FSD meaning, unchanged                                                                                             |
| `src/features/`        | Single user-interaction-driven slices (e.g. `auth/login`)                                                    | Canonical FSD meaning, unchanged                                                                                             |
| `src/entities/`        | Business-domain data + its UI (e.g. `user`)                                                                  | Canonical FSD meaning, unchanged                                                                                             |
| `src/shared/`          | Generic reusable code with no business meaning: UI primitives, API client, hooks, lib, store                 | Canonical FSD meaning, unchanged                                                                                             |

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
This is enforced by `eslint-plugin-boundaries`, not by convention — see
[Boundaries & guardrails](./fsd-boundaries-and-guardrails.md#import-rules) for
what each rule catches, including the `shared` exception below.

A layer may only import from layers below it in the table above (e.g.
`features` may import `entities`/`shared`, never the reverse, and never a
sibling `feature`'s internals).

**`shared/ui` and `shared/lib` are the exception**: they are collections of
independent modules, imported per module (`@/shared/ui/button`,
`@/shared/lib/utils`), which is also the only shape the shadcn CLI generates.
There is no layer-level barrel anywhere — `@/features`, `@/shared` and friends
are not import targets.

## Route thinness

Files under `src/app/` handle **plumbing only**: metadata, route params,
`redirect`, `notFound`, and provider/layout wiring. They must not contain
business UI, direct feature/entity data hooks, substantial JSX, or
client-only state. Composition belongs in `_pages/`:

```
src/app/[locale]/(dashboard)/page.tsx               → imports and renders a _pages/ component
src/_pages/dashboard/DashboardPage/DashboardPage.tsx → owns the actual composition
```

## Locale routing

Every route lives under a `[locale]` segment: `src/app/[locale]/(auth)/login/page.tsx`.
The locale set and default come from `SUPPORTED_LOCALES` / `DEFAULT_LOCALE` in
`@amcore/shared` — the same source the API uses for `User.locale`,
`Accept-Language` negotiation, and email rendering, so the frontend can never
disagree with the backend about which locales exist.

`localePrefix` is `'always'`: **every** locale is explicit, including the
default — `/en/login`, `/ru/login`. A request to `/login` redirects to
`/en/login`; an unsupported locale such as `/de/login` is a 404, never a silent
fallback to English.

`'as-needed'` (default locale at bare `/login`) looks nicer and is deliberately
**not** used. It needs the proxy to rewrite `/login` → `/en/login` internally,
and Next's standalone server — what the Docker image runs — does not consume
the resulting `x-middleware-rewrite`; it returns it to the client alongside a
307 to the original path, so `/login` redirects to itself forever
(vercel/next.js#91844). `'always'` reaches every locale by redirect, which
standalone handles correctly. Do not switch back without re-testing against the
standalone server — `next start` does not reproduce the fault.

Two rules that are easy to get wrong:

- **Import navigation from `@/i18n/navigation`, never from `next/link` or
  `next/navigation`.** The Next.js originals do not know about the `[locale]`
  segment and drop the prefix silently — a Russian user ends up back on the
  English route with no error anywhere. An ESLint rule enforces this;
  `notFound()` and other non-navigating helpers may still come from
  `next/navigation`.
- **Call `setRequestLocale(locale)` before any other next-intl call** in each
  page/layout that should render statically, passing it through
  `resolveLocaleParam(params)` from `@/i18n/params` so the URL segment is
  validated. Skipping it makes the route silently opt out of static rendering.

Locale resolution order: URL prefix → the signed-in user's stored
`User.locale` (applied at the post-login redirect) → the `NEXT_LOCALE` cookie →
`Accept-Language` → `DEFAULT_LOCALE`. An explicit URL prefix always wins for
the request it is on, so following a `/ru/...` link is never overridden
mid-session. The language switcher writes both the cookie and — when signed
in — `PATCH /auth/me`, so the choice follows the user to other devices and to
their email.

Message catalogues live in `apps/web/messages/`. **`en.json` is the source of
truth**; every other catalogue must have exactly the same keys, which a test
enforces. Translation keys are type-checked against `en.json` via the
`AppConfig` augmentation in `src/global.d.ts`, so a typo fails `pnpm typecheck`
rather than surfacing in the browser.

## API errors

The backend emits a stable machine-readable `errorCode` (ADR-023) and an English
`message` written for developers. **The frontend translates by code and never
renders the backend's message** — showing it puts developer-facing English in
front of a Russian user, which is the whole reason the code contract exists.

Render failures with `<ApiErrorAlert error={error} />`, or call `useApiError()`
for the resolved `{ code, message, correlationId, isUnknown }`. Codes that the
client does not recognise fall back to a generic message plus the correlation
ID — that is what support needs to find the request, and it leaks nothing.

`shared/api/errors.ts` is the locale-agnostic layer: it returns codes, never
prose. Network failures and timeouts get their own client-side codes
(`NETWORK_ERROR`, `TIMEOUT`) so every failure, wherever it came from, goes
through one translation path.

**Adding a backend error code** — add it to the enum in `@amcore/shared`, then
add a message under `errors.<CODE>` in _every_ catalogue.
`src/shared/api/error-messages.test.ts` derives its expectations from the shared
enums, so a code with no translation fails the build rather than silently
degrading to the generic message. It also fails on an orphaned message, which
catches a typo or a code the backend has since removed.

## Form validation

Build forms with **`useLocalizedForm(schema, options)`** rather than `useForm` +
`zodResolver` directly. It wires a per-parse Zod error map so validation
messages render in the active locale.

Zod's own `z.config(z.locales.*)` is deliberately not used: it sets the locale
**process-globally**, cannot be scoped to a request or a render
([colinhacks/zod#4986](https://github.com/colinhacks/zod/issues/4986)), and so
cannot represent two live locales — on the server it would race across requests.
An ESLint rule blocks it.

Two rules follow from Zod's precedence (schema-level → per-parse → global →
locale):

- **Never put a literal `message` in a shared schema.** A schema-level message
  outranks the per-parse map and silently defeats localization for that field.
  Schemas stay language-neutral; `superRefine` rules carry `params.errorCode`
  instead, which the map translates through the same `errors.*` catalogue that
  API errors use — so a rule enforced on both client and server reads
  identically wherever it fires.
- **Server-side field errors are localized by code too.** `useFormMutation`
  maps `errors[]` entries through `useFieldErrorTranslator`, never the wire
  `message`. That path is necessarily coarser — the wire format carries no
  `minimum`/`format` — so it is the backstop, with the client schema catching
  most issues first.

## Server/Client Component defaults

**Server Components are the default** for routes and page composition.
`'use client'` is pushed down to the leaf component that actually needs:

- interactivity (event handlers, form state);
- effects (`useEffect`, subscriptions);
- browser-only APIs;
- a Zustand store or a TanStack Query hook.

`app/providers.tsx` is the reference client boundary: everything above it
(`app/layout.tsx`) stays a Server Component (it can `await getLocale()` /
`getMessages()` directly), and the client-only providers (query client, PWA)
are isolated below that one boundary rather than marking the whole tree
client-side. There is no separate client-side auth store — see "State
model" below.

## State model

| Kind                                                        | Use            | Example                             |
| ----------------------------------------------------------- | -------------- | ----------------------------------- |
| **Server state** (data owned by the backend)                | TanStack Query | `entities/user/api/user-queries.ts` |
| **Local client state** (UI-only, not persisted server-side) | Zustand        | `shared/store/stores/ui.ts`         |

Don't duplicate server state into a Zustand store "for convenience" — that's
how the two fall out of sync. If a value needs to survive a page navigation
and isn't server data, it's a Zustand candidate; if it comes from the API,
it's a query. The current user used to live in a parallel Zustand
`useAuthStore`, populated by a mount-time effect — a hand-rolled duplicate of
what `useCurrentUser()` already did declaratively. Removed once nothing
else needed the store (ADR-068 UI-rewiring slice, `ai/models-talk.md`):
`useCurrentUser()`/`userKeys.me()` is the one source now, and
login/register/logout mutate it directly via `queryClient.setQueryData`/
`queryClient.clear()` rather than an imperative store action.

## Relationship to backend/OpenAPI docs

`docs/frontend/` documents **consumption patterns** — how the frontend calls
the backend, maps errors, and structures query keys. It never re-documents
endpoint shapes; those live in the Swagger/OpenAPI document at `/docs`
(`apps/api/src/swagger.config.ts`), per `AGENTS.md`'s "OpenAPI is public
documentation" rule. When in doubt about a request/response shape, the
answer is `/docs` or the shared Zod schema in `packages/shared`, not this
guide.

### Browser API reach

All browser-side calls go through this app's own same-origin `/api/*` Route
Handlers (ADR-068) — never a `next.config.ts` `rewrites()` proxy, and never
a direct cross-origin client against `apps/api`. Same-origin avoids a class
of CORS/cookie problems for free, and it's what lets the browser hold only
one opaque `amcore_session` cookie instead of a backend access token in any
form.

Two shapes of Route Handler cover the whole surface, both under
`apps/web/src/app/api/`:

- **Dedicated handlers** for auth-specific concerns that need the raw
  backend `refresh_token` server-side (`/api/auth/login`, `/register`,
  `/logout`, the OAuth init/callback/exchange routes) — see
  `shared/api/bff/`.
- **The generic catch-all** (`/api/[...path]`) for everything else: reads
  `amcore_session`, refreshes the access token if needed
  (`ensureFreshSession`), and proxies to `apps/api` with `Authorization:
Bearer` attached server-side.

`apps/web/src/shared/api/http-client.ts` is the reference client for
Client Components: same-origin relative paths (`fetch('/api' + path)`), no
manual `Authorization` header, no manual `credentials` option (`fetch`
already defaults to `credentials: 'same-origin'`). `ApiRequestError`/
`ApiNetworkError` replace what used to be `AxiosError` detection in
`shared/api/errors.ts` — same public function signatures
(`isApiError`/`getValidationErrors`/etc.), so `ApiErrorAlert`/
`useFormMutation` never needed to change.

**Historical note, resolved:** earlier revisions of this guide flagged
`shared/api/client.ts` as a known gap — a direct cross-origin axios client
against `NEXT_PUBLIC_API_URL`, predating ADR-068. It's deleted; `axios` is
no longer a dependency of `apps/web` at all. A stale `next.config.ts`
`rewrites()` block that once forwarded `/api/:path*` straight to `apps/api`
(missing the `/api/v1` prefix Route Handlers add, and silently shadowing
the `[...path]` catch-all for any path that isn't one of the few static
routes — Next checks array-form `rewrites()` _before_ dynamic routes) was
removed in the same slice; confirmed live via a `GET /api/auth/me` that had
been quietly 404ing through the stale rewrite.

## The recipe — adding a route

1. Add the route file under `src/app/[locale]/` (`page.tsx`, `layout.tsx`,
   etc.) — metadata and plumbing only. Server Component pages should call
   `setRequestLocale(await resolveLocaleParam(params))` first; see
   [Locale routing](#locale-routing).
2. Build the actual page composition under `src/_pages/<route>/`, importing
   whatever `widgets`/`features`/`entities` it needs through their public
   APIs.
3. If the route needs new server state, add a query (and query keys) in the
   owning `entities/` slice, following `entities/user/api/user-queries.ts`.
4. If the route needs new local UI state, add it to `shared/store` or a
   feature-local store — only promote it to `shared` if more than one feature
   needs it.
5. Decide Server vs Client for each new component per
   [Server/Client Component defaults](#serverclient-component-defaults)
   before defaulting to `'use client'`.
6. Add copy to **every** catalogue under `apps/web/messages/`, starting from
   `en.json` — the parity test fails a key that exists in one locale only.
   Never inline user-facing text in a component.
7. Update this guide's tables only if the route introduces a new pattern, not
   for routine additions.

## Downstream adoption

A downstream product forks `apps/web` **in place**: same repository layout,
same layer contract described in this guide. Branding, theme, and design
tokens (Track 2) replace assets, copy, and tokens — they do not change this
architectural structure.

## See also

- [Brand, theme, and design tokens](./brand-theme-and-tokens.md) — token
  architecture, light/dark/system modes, the no-flash mechanism, and the
  downstream rebrand checklist.
- [Shared UI & shadcn](./shared-ui-and-shadcn.md) — the `shared/ui` reuse
  rule, the safe shadcn CLI procedure, and the current primitive inventory.
- [API consumption](./api-consumption.md) — the hooks that consume media,
  notifications, and AI through the BFF Route Handler layer this page
  describes.
- [Testing](./testing.md) — the frontend test taxonomy; in particular, why
  `async` Server Components and `requireSession()`-gated pages need the
  real-stack E2E lane rather than a Vitest unit test (Vitest cannot test
  `async` Server Components at all — Next's own bundled docs say so).
- [Storybook](./storybook.md) — the component workshop and its own
  accessibility gate, a fifth layer of the testing pyramid above.
- [Backend architecture & conventions](../backend/architecture-and-conventions.md) —
  the equivalent contract for `apps/api`.
- `AGENTS.md` → Code conventions — the condensed cross-tool version of the
  rules on this page.
- Later frontend/admin starter tracks add their own guide here as they land.
