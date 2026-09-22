# Extending Operations Console

Read the [user guide](README.md) and [configuration and
deployment](configuration.md) first. The console is a `SUPER_ADMIN` system
control plane, never a product backoffice.

## Ownership and security boundaries

| Concern             | Owned location or rule                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route plumbing      | Upstream: `apps/web/src/app/[locale]/admin/**`; scaffolding relocates or renames it for the selected locale mode and slug. Keep the resulting route thin. |
| Page composition    | `apps/web/src/_pages/console/**`                                                                                                                          |
| Shell               | `apps/web/src/widgets/console-shell/**`; reuse `shared/ui`, not the product app shell                                                                     |
| Console BFF         | `apps/web/src/app/api/console/**`; every handler starts with `withConsoleHostGuard()`                                                                     |
| Live page admission | `ConsolePageFrame` calls `requireSuperAdmin()` on every protected page before mounting chrome; never trust a JWT role snapshot or UI state                |
| Public navigation   | `RouteProgressLink` and the console public-href helper                                                                                                    |

Do not reuse console routes, BFF namespace, session audience, or `SUPER_ADMIN`
as shortcuts for a downstream product backoffice. Every backend data endpoint
must perform its own live `SUPER_ADMIN` authorization; the page-level admission
frame may mount chrome but never authorizes later data access.

The Users panel's system-role promote/demote action is the console's first
mutation, and its BFF plumbing is the reusable seam for the next one — don't
re-derive it from scratch:

- **Session/origin resolution** lives in
  `shared/api/console/authenticated-proxy.ts`
  (`resolveConsoleAccessToken`/`isConsoleRequestOriginTrusted`): it selects
  the isolated console vault and the strict console-host origin check in host
  mode, and the product session and `WEB_TRUSTED_ORIGINS` check in path mode.
  Every console mutation Route Handler resolves through this, not a
  hand-rolled per-mode branch.
- **Fixed public routes only.** A console mutation's Route Handler forwards
  to exactly one backend target it names itself — never a client-supplied
  path — and validates its request body against the same shared Zod schema
  the backend DTO uses, before forwarding. See
  `app/api/console/users/[id]/role/route.ts` for the reference shape.
- **Token containment.** If a mutation's upstream success response can ever
  carry a credential (an access/refresh token — `POST /auth/step-up` is the
  first and, so far, only example), its Route Handler must **not** stream
  that response back verbatim the way an ordinary mutation proxy does: read
  the body server-side, discard the credential entirely, and respond without
  it (`shared/api/console/step-up.ts` is the reference; it responds `204`).
  Getting this wrong hands a real backend bearer token to browser JavaScript
  — treat it as a security bug, not a style preference, and add a regression
  test asserting the response body never contains `accessToken`/
  `refreshToken` for any such route.
- **Step-up UX** stays a local, cohesive component beside the page that needs
  it (see `_pages/console/UsersPage/RoleStepUpDialog.tsx`) until a second
  console mutation needs the identical dialog — do not pre-emptively promote
  it to a shared/cross-slice widget before that second real consumer exists.

This preserves the [step-up re-authentication
boundary](../auth/sessions.md#step-up-re-authentication) for every future
dangerous action, in both topologies — the host-mode console-audience flow
this section previously called out as undesigned is now built and reviewed.

Console files added below the closed roots listed above are scaffold-owned
automatically. A Console contribution to shared navigation, config, scripts,
CI, or mixed docs must declare a narrow seam or structural operation. Novel
unmarked semantics remain an explicit author/reviewer classification boundary;
see the [worked ownership examples](../frontend/brand-theme-and-tokens.md#optional-feature-extension-ownership).

## Add a functional panel

1. Obtain a narrowly scoped plan and classify every datum as primary or
   secondary.
2. Inspect `ADMIN_CONSOLE_CONFIG` and the actual generated route tree; do not
   assume the upstream `[locale]/admin` path still exists.
3. Add thin route plumbing and `_pages/console` composition, using the existing
   shell and semantic tokens.
4. Add copy for every retained locale and progress-aware public navigation.
5. Choose the transport deliberately. The line that matters is not "does this
   page have any `'use client'` component" — Overview's refresh button and
   Users' search input both do — it's **does a browser ever
   initiate its own API call**. A page can fetch straight from its Server
   Component via `shared/api/server`'s `fetchBackend()`, passing a
   console-aware `tokenResolver` (`shared/api/console/access-token.ts`'s
   `getConsoleAwareAccessToken`) instead of the product-session default, and
   still have a client component in it — as long as that client component's
   only job is to change the page's own URL (a router refresh, a debounced
   search box, a sort-header link) and let the existing Server Component
   re-fetch on the resulting navigation. No separate Route Handler is needed
   for that case, Organizations and Overview included. Every protected page
   must render through `ConsolePageFrame`, because a persisted App Router
   layout is not a sufficient re-check on sibling navigation and must not
   retain chrome after denied/unavailable admission. The frame remounts the
   shell after an admitted sibling navigation, so it must also read the
   existing non-sensitive `sidebar_state` preference and pass it to
   `ConsoleShell`; this preserves the operator's collapsed/expanded choice
   without ever participating in admission. Pass the frame a page-specific
   skeleton that mirrors the final page's desktop and narrow-screen layout —
   **and keep it that way**: a skeleton is written once against the page as
   it looks that day, and every later PR that changes the page's visible
   structure (a new control, a changed column set, a reflowed header) must
   update the skeleton in the same PR, or it silently drifts into a shape
   the real page no longer has. Do not add a protected-route `loading.tsx`:
   it resolves outside the frame and can replace the shell before admission.
   Only the part of the page that actually depends on the backend fetch
   should sit behind a `<Suspense>` at all — static chrome (a heading, a
   search box that only reads already-parsed `searchParams` props) belongs
   outside it, rendered by the page immediately. Users is the worked
   example: `UsersPage` renders its `<h1>` and `SearchInput` directly, then
   wraps only `UsersResults` (the component that calls `fetchConsoleUsers`)
   in its own `<Suspense fallback={<UsersResultsSkeleton />}>` — nested
   inside `UsersPageSkeleton`, which composes a heading/search placeholder
   with that same `UsersResultsSkeleton` for `ConsolePageFrame`'s own outer
   fallback (the cold/first-load case). Gating static chrome behind the
   fetch instead, as a single async component that awaits before rendering
   anything, means the heading and search box unmount and remount — losing
   the search box's own in-progress typed value — on every search/sort/page
   navigation, not just on first load; Organizations and Overview should
   move to this same shape when next touched (not a requirement to do so
   opportunistically outside their own PRs). A panel with any genuinely
   **browser-initiated** call (a mutation, a client-side poll, anything a
   `'use client'` component fetches on its own after load, as opposed to
   just navigating) still needs its own handler under `app/api/console/**`,
   applying `withConsoleHostGuard()` explicitly, since that guard is a
   per-route-handler concern, not inherited from the page layout. Either way,
   independently authorize the corresponding backend endpoint — the
   admission frame mounts chrome, never grants data access. A mutation
   reuses the session/origin/token-containment seam described above under
   "Ownership and security boundaries" rather than a new one-off proxy.
6. **Reuse `features/console-discovery` for search/sort, don't reimplement
   it per panel.** Users already solved debounced live search, sortable
   column headers, and canonical
   `?search=&sortBy=&sortOrder=` URL-building as a console-scoped
   `features/console-discovery` slice — the same shape as the
   `features/console-login`/`console-logout` precedent (`ui/` + `model/` +
   a thin `index.ts` public API), not `shared` (not app-wide) and not
   `_pages/console` (composition only, per this file's ownership rules
   above). A future panel that lists, searches, or sorts anything (a queue,
   an audit log, sessions, or any other tabular data) imports the
   query-string builder, `SortableColumnHead`, and
   `SearchInput` from there instead of rebuilding the same debounce/URL
   plumbing again. Two UI details that look optional but were caught by
   review and are not: every sortable-but-inactive header shows a neutral
   sort icon (not just the active column), and a search field's custom
   clear button uses `type="text"` (never `type="search"`, whose native
   browser clear button would sit beside a custom one) and refocuses the
   input after clearing.
7. Use the existing graceful-degradation primitives for secondary data. Keep
   primary failures explicit and fail privileged actions closed.
8. Add focused unit tests, Storybook/a11y states where applicable, and
   browser/real-stack coverage for auth, cookies, Redis, or proxy behavior.
9. Update the plain-language `SUPER_ADMIN` documentation in the same PR:
   purpose, statuses, actions, dangerous operations, and degraded/error states.

Do not describe the panel as available until its implementation and user
instructions ship together.

## Verification

- [Frontend testing](../frontend/testing.md) explains unit, Storybook, browser,
  and real-stack layers.
- Run `pnpm test:console-session-e2e` for the isolated HTTPS console
  cookie/Redis audience lane.
- Run `pnpm test:scripts` when the scaffold-owned surface or generated output
  changes; its single-locale host proxy smoke covers nginx and Caddy.
- Run `pnpm --filter web test:storybook` for component interaction and a11y
  states.
- Run `pnpm test:observability-contract` after tracked documentation changes.
- Follow the root `AGENTS.md` runtime-verification rule for Next.js behavior.
