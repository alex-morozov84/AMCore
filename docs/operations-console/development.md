# Extending Operations Console

Start with the [screen guide index](README.md) and [configuration and
deployment](configuration.md). The console is a `SUPER_ADMIN` system control
plane, never a product backoffice.

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
- **Step-up UX** for the user role change lives in
  `features/console-user-role`, reused by the Users inventory and user detail
  page. A future mutation should reuse that feature only when it has the same
  role-change responsibility and authorization contract.

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
   example: `UsersPage` and `OrganizationsPage` render their `<h1>` and
   `SearchInput` directly, then wrap only their async results component in a
   results-specific `<Suspense>` — nested inside the full page skeleton used
   by `ConsolePageFrame` for the cold/first-load case. Gating static chrome
   behind the fetch instead, as a single async component that awaits before
   rendering anything, means the heading and search box unmount and remount
   — losing the search box's own in-progress typed value — on every
   search/sort/page navigation, not just on first load. A panel with any genuinely
   **browser-initiated** call (a mutation, a client-side poll, anything a
   `'use client'` component fetches on its own after load, as opposed to
   just navigating) still needs its own handler under `app/api/console/**`,
   applying `withConsoleHostGuard()` explicitly, since that guard is a
   per-route-handler concern, not inherited from the page layout. Either way,
   independently authorize the corresponding backend endpoint — the
   admission frame mounts chrome, never grants data access. A mutation
   reuses the session/origin/token-containment seam described above under
   "Ownership and security boundaries" rather than a new one-off proxy.
6. **Compose shared search primitives through `features/console-discovery`.**
   The [frontend search guide](../frontend/search/README.md) documents the
   reusable APIs and downstream composition; the rules below are Console-only.
   `SearchField` and `useDebouncedDraft` are console-independent starter
   capabilities under `shared/ui` and `shared/lib`; they remain available in
   a fork that removes the optional Console. The Console slice is the thin
   adapter that owns `search`/`sortBy`/`sortOrder`, trim and 255-character
   policy, page-1 reset, canonical hrefs, route-progress navigation and
   domain sort composition. Future Console panels import `SearchInput`,
   `SortableColumnHead`, `DiscoverySearchBoundary` and discovery links from
   that slice's public API rather than rebuilding the policy.

   Place the search and results beneath one `DiscoverySearchBoundary` while
   keeping only the async results under `<Suspense>`. Use
   `DiscoveryNavigationLink` for every sort, pagination and out-of-range
   recovery action: a real current-tab navigation discards an armed draft
   before the link wins, while modifier/new-tab activation leaves this tab's
   draft alone. Programmatic search uses App Router's last-navigation-wins
   `replace()` behavior, so only the latest non-discarded search response is an
   expected self echo. A different canonical Back/Forward view resyncs the field;
   an exact identity still awaiting its own router echo is indistinguishable
   from that echo and deliberately preserves the newer draft. The GET form
   and real link hrefs remain the no-JavaScript fallback.

   Two UI details remain mandatory: every sortable-but-inactive header shows
   a neutral sort icon, and the shared field uses `type="text"` so its one
   custom clear button is not duplicated by a browser-native search control;
   clearing returns focus to the field.

   Audit is a structured-filter and opaque-cursor exception: its exact ID,
   action and time filters deliberately submit together. Its current-name
   lookup suggests at most ten matches; choosing one applies only the safe ID
   in the URL. The fixed POST handler under `app/api/console/audit/lookup`
   uses `withConsoleHostGuard()` and topology-aware session/origin resolution.
   The log list is a Server Component read with the console-aware token and
   `cache: 'no-store'`; Audit links disable prefetch so merely seeing one does
   not create a privileged read-audit event. T002's discovery URL and numbered
   page contract do not apply to Audit; its generic field may be reused only
   where the interaction contract matches.

   User and organization detail pages use separate backend `GET` endpoints and
   the console-aware server token, with no browser read proxy. They keep the
   heading and contextual return link outside relation refresh boundaries,
   use the same debounced search field for organizations/members, and supply
   matching cold-page and relation-refresh skeletons. Their links from Users,
   Organizations and Audit carry a bounded same-Console return location.
   Their relation search sits within the detail results boundary so it appears
   only after the entity is found; the running-page check must confirm that a
   search navigation preserves its draft and focus. This differs from the
   inventory pages, whose search boxes stay outside the results boundary.
   Identity links save the clicked row and scroll position for same-tab return;
   restore only after fresh list/Audit results render. Modified clicks and
   direct bookmarks retain normal navigation. Detail-to-Audit links choose an
   explicit 31-day interval and explain its scope. Do not turn an empty Audit
   result into a claim about older activity.

7. Use the existing graceful-degradation primitives for secondary data. Keep
   primary failures explicit and fail privileged actions closed.
8. Add focused unit tests, Storybook/a11y states where applicable, and
   browser/real-stack coverage for auth, cookies, Redis, or proxy behavior.
9. Update the affected [screen guide](README.md) in the same PR. A new panel
   needs its own page linked from the index. Explain its purpose, typical
   tasks, visible statuses, available actions, dangerous operations, and
   degraded or error states in language an operator can use.

Do not describe a planned panel as available. Its implementation, index link,
and operator instructions ship together.

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
