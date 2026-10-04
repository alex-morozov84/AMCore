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
- **Step-up UX** is shared by role changes and session revocation through
  `shared/lib/console-step-up-mutation.ts` and
  `shared/ui/console-step-up-dialog.tsx`. Each feature owns its mutation and
  success handling; the shared hook performs password re-authentication and
  exactly one retry, with terminal handling for repeated freshness rejection
  or unavailable password step-up. Reuse these shared modules for the same
  interaction contract; do not import a sibling feature's internals.

This preserves the [step-up re-authentication
boundary](../auth/sessions.md#step-up-re-authentication) in both topologies.
Host-mode step-up uses the Console audience and session; it does not replace the
product session. Capture the intended value and revision before re-authentication
for settings writes; a conflict or uncertain outcome requires an authoritative
reread, not replay of a newly edited draft.

Console files added below the closed roots listed above are scaffold-owned
automatically. A Console contribution to shared navigation, config, scripts,
CI, or mixed docs must declare a narrow seam or structural operation. Novel
unmarked semantics remain an explicit author/reviewer classification boundary;
see the [worked ownership examples](../frontend/brand-theme-and-tokens.md#optional-feature-extension-ownership).

### Overview observation contract

`GET /api/v1/admin/overview` retains live personal-JWT `SUPER_ADMIN` admission;
API keys remain ineligible. Its response is `private, no-store`. The Console
adapter opts into fetch `no-store` without changing other server consumers.
The shared Zod schema is the API and web contract: readiness/dependencies are
separate from generated build identity, cached independent storage observation and independently dated
pool, memory and fixed-root filesystem samples. A secondary read failure produces
only an unavailable sample, while an unexpected readiness failure remains HTTP 500. Swagger documents that error; a browser deadline is not an API 503 contract.

Do not turn a resource count into a health verdict, expose arbitrary filesystem
paths or copy full environment/health-error objects into the response. Keep web
artifact identity local to the web build. Console UI, stories and adapters under
closed Console roots are removed with the feature; shared schemas, backend
sampling, deployment inputs and the generic fetch option remain reusable core.

### Interactive session data inside a server-rendered page

The User Detail Sessions card is an interactive client leaf. Its Query calls a
fixed Console BFF list route, while the surrounding detail page and membership
search keep server-rendered, URL-driven reads. `features/console-user-sessions`
shows how to key data by target user, UI locale and local page; retain previous
rows only for paging within the same target/locale. Its retry button refetches
that Query, and revocation invalidates every page/locale for the target.

Reuse `shared/ui/pagination.tsx`'s `PaginationButtons` for local Previous/Next
paging and `shared/lib/format-session.ts` for descriptive device/location
presentation. API sessionId is a family identity that survives rotation; never
replace it with a token hash or infer authorization from the displayed device.

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
   for that case: Organizations and Overview's cached observation read use this
   server-rendered path. Overview's inline interval editor independently initiates
   browser GET/PATCH requests and needs its fixed Console BFF handler; do not
   infer a whole page's transport from its server-rendered observations.
   Every protected page must render through `ConsolePageFrame`, because a persisted
   App Router layout is not a sufficient re-check on sibling navigation and must not
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

## Live panels: Background work

Overview and the inventories are refreshed on request. **Background work** is the
reference for a panel that also refreshes itself. Its pieces:

- The Server Component fetches the first snapshot with `fetchBackend` (`no-store`,
  the Console token resolver); the Console frame's skeleton covers that wait. A
  transport failure of that request is the primary-unavailable state, which keeps
  the heading; a per-item failure is typed data inside a successful response.
- One interactive leaf in the page folder keeps the data fresh with a single
  TanStack Query observer. It starts from the server snapshot (`initialData`), so
  the first paint has no flash, and it reads a fixed Console BFF `GET`
  (`app/api/console/background-work/queues`, guarded by `withConsoleHostGuard()`,
  with no client-supplied path and no token in the response). The handler passes
  the browser's abort on and adds its own deadline.
- The refresh policy lives in one hook and one pure module
  (`use-queue-summary.ts`, `queue-poll-policy.ts`). Automatic fetches (interval,
  focus, reconnect, mount) are allowed by a single rule: auto-refresh on, access
  intact, tab visible, browser online and every cool-down elapsed. Losing that
  admission cancels queued or in-flight automatic work. A manual refresh joins a
  fetch already running, honours `Retry-After`, and is never queued while offline.
  The hook owns the failure streak, because a `200` whose items are all
  unavailable is a success for Query but not for the operator. After `401`/`403`
  it hides the data at once, evicts the cache and asks the Console frame to
  admit the session again (`router.refresh()`).
- Query state is isolated per mount (`gcTime: 0` and a per-mount key), so a
  remount can never show older or denied data instead of the server's snapshot.
- Build recovery after a deployment is unchanged: the global deployment check
  reloads an old tab. A live panel uses a plain `GET`, never a Server Action, and
  needs no version check of its own.

Reuse the `use-queue-summary.ts` shape for another live panel. Promote the
policy to `shared/lib` when a second panel needs it; the storage setting editor
polls with different rules (fixed 2 seconds only while a saved value is still
being applied) and does not use it.

## Queues and the Background work screen

The screen reads the queue inventory, a single code-owned list in
`apps/api/src/infrastructure/queue/constants/queue-inventory.constant.ts`. A new
queue appears on the screen after its descriptor is added there; a test fails when
ordinary code registers or constructs a queue outside the list (a structural check:
aliases and multi-line calls count, dynamic construction does not). See the
[queue guide](../../apps/api/src/infrastructure/queue/README.md#adding-a-queue)
and the [screen guide](background-work.md#adding-a-queue-for-developers). The
backend reads Redis with plain read commands and a bounded number of pending
requests, so a stalled Redis cannot pile up work behind the screen.

## Queue board

The board entry on Background work is a page-owned composition (`BoardOpenAction` with the page
actions and `BoardNotices` above the table, with the state rule in `board-entry-state.ts`)
rendered inside the live leaf, so it follows the same snapshot as the rows. The button carries the
standing view-only explanation in the shared `InfoTooltip`, as Auto-refresh does. The notices use
the shared `Alert` as it is: `role="note"` (the component sets `role="alert"` first and spreads
your props after it) and `className="line-clamp-none"` so a long title wraps. Its texts are props from the page's catalogue keys
(`console.backgroundWork.board.*`); `shared/ui` holds no message keys and no access logic.

The board is reached only through `app/api/console/bull-board/[[...path]]/route.ts` and
`shared/api/console/board-handler.ts`: a fixed bridge, not a proxy. Do not add a second route to
the API's `/admin/queues` mount, and do not widen the allowed paths or query keys without
extending the API's own list (`bull-board-route-policy.ts`). To show the payload of your own
queue in the board, add a projection (see
[Showing the payload of your own queue](queue-board.md#showing-the-payload-of-your-own-queue)).

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

Common API privilege admission runs before ability construction and before Console
SystemRoles/FreshAuth. It checks privileged claims against primary role once and
passes an effective principal to downstream consumers. SystemRoles reuses the
original-claim/current-role evidence; FreshAuth still independently verifies the
session freshness. Console routes remain bearer-only, and host/product vault and
origin boundaries are unchanged. Do not add another claim-only platform bypass.

## API-key inventory composition

API keys reuse discovery optional `extraQuery` for status/identity/limit fields,
with stable canonical URL identity and a100-character search override. Preserve
extras in sort/page/search and GET fallback; use the draft-discard API before
programmatic filters. Page selection is bound to full identity and intersects
fresh eligible results; confirmation owns a captured snapshot through step-up.

Generic `shared/ui/identity-lookup` owns the input/debounce/result interaction;
Console adapters own lookup transport and copy. It remains available in a fork
without Console. Import the shared module rather than a sibling page's internals.
The safe inventory reads directly in RSC with the console-aware token/no-store;
fixed revoke BFF routes use the existing origin/session seam. Optional Console
removal leaves backend admin endpoints, core lifecycle and shared API contracts.

The storage snapshot includes `nextScheduledAt` (nullable ISO timestamp from the
server scheduler) and `inProgress`. Never derive scheduling from `checkedAt` plus
cadence: it records result publication, including timeout, rather than start time.
During an active or stopped probe, no next transaction start is promised.

## Runtime interval editor

Overview's File storage editor is a client leaf in `features/console-storage-setting`.
It reads authoritative saved state through a fixed Console BFF GET, while the
surrounding server-rendered Overview keeps its cached observations. It uses the
shared step-up hook with captured value/revision, keeps the draft on conflict,
and rereads ambiguous writes without automatic replay. The editor never starts
storage I/O. No Settings route or navigation item is added.

The [backend settings foundation](../backend/settings.md) owns ordinary definitions,
persistence, atomic audit and runtime reconciliation. Console removal owns only
this editor, its BFF/UI copy and adapters; shared contracts, backend API, migration
and API/worker reader remain core. Organization capability catalogue/permissions
remain separate from personal platform settings rights.
