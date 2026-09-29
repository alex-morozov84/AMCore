# Organization foundation UI and headless composition

In multi-locale builds, the product sidebar's Organizations entry opens
`/[locale]/organizations`. A single-locale fork uses `/organizations` and
`/organizations/[id]` after the standard project initializer moves the routes.
An empty successful list explains how to request an invitation; it does not
create an organization or accept invitations. One membership opens its overview
automatically. The overview's All organizations link uses `?view=list` to avoid
a single-organization redirect loop. Multiple memberships use cards and URL
pagination, 20 per page. There is no search, table or organization CRUD UI.

`/[locale]/organizations/[id]` confirms the company, signed-in account and full
team-access affordance. It is a read-only landing point for future downstream
work. Team, role and invitation screens are not included; no inactive links
promise them. A missing/removed target stays unavailable at that URL; it never
silently adopts another organization. Capability text never grants authority.

## Ordered data and identity lifecycle

The organization frame admits a safe binding through the entity server DAL,
without an API request or credential refresh. It does not loop back through
its own HTTP routes or prefetch list/context for duplicate hydration. Client
mount verifies bootstrap then reads exactly one active list or overview.
Single-entry redirection creates the selected mount: two bootstrap plus two
domain requests in total, zero switches. Fresh sessions need zero refreshes.

Focus, visible visibilitychange and persisted pageshow suspend old content
immediately and coalesce through one100ms trailing scheduler. Manual Refresh
uses the same scheduler; an in-flight cycle is joined. Bootstrap must match
the admitted login/actor binding before current authority is reread. Changed
binding displays Reload, with no old authority request. Same binding with
changed membership or permissions displays unavailable/recomputed access.
Validated target/page/locale input changes issue one active authority read.
Disabled Query observers own cached server data and never independently
refetch, retry or poll. Idle causes no requests.

A429 respects Retry-After; recovery is explicit, not polling. Transport/schema
failures never appear as an empty list or stale authorized content. One bounded
list recovery handles an inconsistent/out-of-range envelope; persistent
inconsistency displays an explicit recovery message. Total and rows are not
claimed to be one transactional snapshot. No mutation is automatically replayed.

## Ownership and reuse

- `entities/organization-context`: safe client/server data, keys, publication
  lease and per-consumer scheduler. No router, menu, fixed mount, shell or toast.
  Backend data belongs to TanStack Query; lifecycle status belongs to its consumer.
- `features/organization-select`: localized cards and pager with caller-owned hrefs.
- `widgets/organization-context-summary`: read-only localized organization/access block.
- `_pages/organization-access`: page content composition, navigation/recovery and
  status presentation.
- `_app/organization-access`: first root mount, safe admission/frame, canonical
  URL builders and the menu insertion. Thin Next routes import this public seam.

Use `useOrganizationContext(binding,input)` for a custom presentation. Inputs
are explicit `{kind:'list',page,locale}` or `{kind:'selected',id,locale}`; each
consumer has its own lifetime, so two tabs/targets cannot change a global active
organization. A cabinet can supply `/manage/organizations` hrefs and another
frame while reusing the headless API or ready blocks. This is a source composition
seam, not a delivered configurable topology framework. Import the server DAL
only through `index.server.ts`, never from a Client Component.

Retire a consumer before accepting another session/target. The headless action
wrapper publishes only into the still-current run; it never cancels an already
committed SQL write. Typed mutation extensions must enforce Origin/strict input
and use the existing server executor, not a browser-provided operation URL.
See the [API context contract](../auth/organization-context.md).

## Interaction, accessibility and verification

Existing Card, Button(Base UI render), Empty, Skeleton, Alert, ApiErrorAlert,
Pagination, RouteProgressLink, Sidebar/Sheet and semantic theme tokens are reused.
Shared BackLink renders a decorative Lucide ArrowLeft and the caller's localized
label/destination. Console owns its filtered return URL; product context owns
the explicit list URL. The shared presentation survives Console removal.
Content skeletons mirror the two-column desktop/one-column mobile card structure;
shell/navigation stays visible. Error/denied/session-change states reveal no old
company name. Both en/ru catalogues are supported, with system/light/dark themes.
Reduced-motion preferences suppress skeleton/spinner animations; status is polite,
card Open labels include the company, headings preserve hierarchy and there is
no nested main.

The product shell closes its mobile Sheet through AcceptedNavigationProvider
after the link caller accepts a different same-origin navigation. Cancelled,
modifier/new-tab, external/download and current/pure-hash clicks leave it open.
This is independent of whether route progress is enabled. Operations Console
keeps its own pages, mount and admission; product context does not authorize it.

Targeted scheduler/MSW tests assert request order and retirement; managed real-stack
browser checks cover real sessions, membership, refreshed identity, responsive
locale/theme views and axe. See [frontend testing](./testing.md) and
[managed stands](../operations/local-stands.md). Local measurements describe the
selected mechanism only: aggregate SQL/Redis and shared host load cannot establish
per-leg cost, rare-failure reliability, remote/TLS behavior or historical speedup.
Refresh pacing counts domain and refresh separately in their per-handler buckets.
