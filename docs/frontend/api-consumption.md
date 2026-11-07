# Frontend API Consumption

How `apps/web` consumes the media, notifications, and AI backend surfaces —
auth (login/register/sessions) is already covered by
[`architecture-and-conventions.md`](architecture-and-conventions.md#browser-api-reach)
and isn't repeated here. Each backend surface's HTTP contract (paths, bodies,
status codes) is owned by its own guide — `docs/media/`, `docs/notifications/`,
`docs/ai/` — and by the OpenAPI document at `/docs`; this guide covers the
**consumption pattern**: which hook wraps which endpoint, and why realtime
hooks are simpler here than the backend docs' own direct-consumer guidance.

## The one rule everything below follows

Every browser→backend call goes through this app's own same-origin `/api/*`
Route Handlers (ADR-068), never `apps/api` directly. The browser never holds
an access token — the BFF's Redis-held session vault does — so a frontend
hook never sets an `Authorization` header or attaches a bearer token itself.
Most surfaces need no dedicated Route Handler at all: the generic
authenticated proxy (`shared/api/bff/authenticated-proxy.ts`, mounted at
`/api/[...path]`) streams both the request and response body unmodified,
which already covers a plain JSON call, a multipart upload, and an SSE
stream.

A dedicated route is needed when:

- **The operation selects an organization.** Generic organization-family routes
  are closed for every method. Bootstrap the current identity and use the typed,
  session-fenced product routes or the direct entity server DAL. See
  [explicit organization context](../auth/organization-context.md).
- **The backend returns login credentials.** The generic proxy denies JWT issuance
  before origin, cookie, vault or upstream work, even for an existing session.
  Dedicated handlers must consume those credentials on the server and return a
  safe browser response. See [Credential containment](#credential-containment).
- **The backend needs something the generic proxy can't forward.**
  `/auth/sessions*` needs the raw `refresh_token` cookie to identify the
  caller's own session, which the generic proxy never sees.
- **The caller has no session at all.** The generic proxy requires an
  existing server-selected product or staff session and 401s without one — unusable for
  login/register (nothing to be a session of yet) or the four email-link
  auth actions (`forgot-password`, `reset-password`, `verify-email`,
  `resend-verification` — a user resetting a forgotten password isn't
  logged in, and a verification link may be opened in a browser holding no
  cookies at all). `credential-auth-handler.ts` covers the first two
  (mints a session from the backend's `refresh_token`);
  `public-auth-action.ts` covers the latter four (forwards the backend's
  response verbatim, mints nothing — none of them authenticate anyone).

## Credential containment

The actual hostname and literal server entry select the session context before
any cookie/vault read. Dedicated admin auth routes use `/api/product-admin/auth/*`;
the generic proxy closes the rest of the auth namespace except the explicit
current-user/avatar/session paths. See
[placement and sessions](../product-admin/placement-and-sessions.md) for context,
hop-proof, hostname and compatibility rules.

The generic proxy returns 404 for these effective upstream paths under `/api/v1`:

- `auth/login`, `auth/register`, `auth/refresh`, `auth/step-up`;
- `auth/oauth/exchange`;
- `organizations/:id/switch` (one nonempty organization-ID segment);
- the entire `auth/invites` family, including continuation admission, registration,
  private inspection, acceptance, receipt recovery and authentication handoff.

The check covers all exported HTTP methods, static words regardless of case, and
an optional trailing slash. It checks the same URL that is fetched, after URL
construction resolves dot segments. For security classification it normalizes unreserved percent escapes, repeated
slashes and case; malformed escapes, encoded separators and nested encoding fail
closed. It never rewrites the outbound URL or dynamic IDs. Invitation-family
containment deliberately applies to the whole prefix. Request/response streams remain unbuffered.

Canonical `/api/auth/login` and `/api/auth/register` select dedicated handlers
and return `{ user }` plus an opaque session cookie. Unsupported methods belong
to that selected handler and do not fall back to the generic proxy. Canonical
`/api/auth/oauth/exchange` selects the OAuth provider route: POST returns 405;
it is not a browser exchange endpoint. The localized callback is a public
completion document without session effects. Its native form posts to the literal
site/admin `/api/.../oauth/complete` endpoint. That exact-Origin-admitted handler
performs the server-side exchange and clears the temporary Strict/HttpOnly cookie;
see [OAuth](../auth/oauth.md).

Direct backend APIs remain available to authorized clients and server code.
There is no generic browser organization-switch endpoint. The product executor
uses a personal JWT and an API-verified explicit target without exchanging tokens.
An integration choosing legacy exchange must consume its JWT server-side. API-key issuance is a
separate, explicit one-time secret response and is unaffected by this JWT guard.

When adding a backend JWT issuance route, update the classifier inventory and
its early-rejection tests, and add a deliberate safe server handler if the
browser needs the operation. Do not depend on dedicated-route precedence alone
or add a response scanner that buffers uploads or SSE.

## Registration results in the web application

`POST /api/auth/register` calls the API, then publishes the browser session: it
stores the session in the Redis vault and retires earlier invitation flows. The API
commit and the publication are separate, so publication can fail after the account
exists.

The browser first completes `/api/auth/browser-context` and echoes its nonsecret
attempt identifier. The BFF retains its private proposal before creating the
account. The API commits the account, pending family/session and email token in
one transaction. The BFF prepares Redis state and confirms the exact publication
before setting a session cookie. Invitation registration confirms its handoff in
that same publication transaction; it never accepts membership.

| What the BFF observed                                                                                                                                                                | Response                                                         | Meaning                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The API answered exactly `201` with a valid body and the session was published                                                                                                       | `201 { user }` and the session cookie                            | The person is signed in                                                                                                          |
| The API answered exactly `201` with a valid body, but publication failed (vault write, flow retirement) or the API sent no refresh cookie                                            | `503` with `errorCode: REGISTRATION_SIGN_IN_REQUIRED`, no cookie | The account exists; sign-in is unavailable                                                                                       |
| The API refused the request with a `4xx` (`400` invalid fields, `403 PUBLIC_SIGNUP_DISABLED`, `409 EMAIL_ALREADY_EXISTS`, `429`)                                                     | The same status and body                                         | A known refusal: this request created nothing; handle it by its code. `409` says the email is taken, not who created the account |
| A network failure or timeout; an API `5xx` (forwarded with its own status, for example `500`); an upstream success that is not a valid `201` (`200`, `202`, `204`, an unusable body) | `503` or the forwarded `5xx`                                     | Unknown: the account may or may not exist                                                                                        |

`REGISTRATION_SIGN_IN_REQUIRED` is emitted only by the web BFF, so it is not in the
OpenAPI document. A custom registration form must:

1. not submit the registration again after this code;
2. clear the password field, say that the account was created, and link to sign-in;
3. not write the user into the authenticated cache or navigate as if signed in;
4. after an unknown result, ask the person to wait for the service to recover and then
   try the same email and password, or reset the password. A failed sign-in or a reset
   acknowledgement does not show whether the account exists (sign-in answers the same for
   a missing account and a wrong password). Do not repeat the registration automatically. A repeat started by the person cannot
   create a duplicate: an existing account answers `EMAIL_ALREADY_EXISTS`.

A browser that disconnects before the response gets no notice: sign in or reset the
password.

`POST /api/invitation-flows/{flowId}/register` returns the same code when the API
confirmed the invited account but the invitation session could not be published. The
recipient page keeps a notice and reads the flow context without replaying
credentials; the outcome is described in
[invitation recovery](../auth/invites.md#browser-bff-contract). For what an operator
sees, see [Redis memory](../operations/capacity.md#redis-memory).

## Invitation adapters

After logout, the old session cookie can remain inert. A missing vault entry
supplies no identity to public invitation admission. Existing flows still match
their original session binding. A present vault entry must pass primary
verification; refusal or unavailability never falls back to anonymous admission.
Every new sign-in still requires the exact primary publication protocol.

Organization invitation management uses the dedicated personal, session-fenced
`/api/product-access/organizations/{id}/invites` family. Its safe responses include
`binding` and `data`; create/reissue return202. Direct API revoke returns an empty204,
but its browser adapter returns200 with `{binding,data:{status:"revoked"}}` after
checking that precise204 acknowledgment. A generic proxy cannot enter the closed
organization family. Personal recipient journeys instead use
`/api/invitation-flows/{flowId}` and `/api/invitation-operations/{operationId}`.
Authenticated recipient requests, including inspection, verification, consent and
account switching, pass the selected vault entry to `invitationBackend`. The
transport derives private browser headers from that entry and the actual anchor
cookie. It never accepts those headers from browser input. See the
[browser contract](../auth/invites.md#browser-bff-contract) and
[custom composition](../product-admin/integration.md#custom-invitation-forms).

## Server Components: direct backend transport (ADR-079)

The rule above is about the **browser**. A Server Component runs on the Next
server itself, so looping it back through this app's own `/api/*` routes
would mean the same process calling itself over HTTP for no benefit — the
installed Next docs are explicit that Server Components should fetch from
the source directly instead (`node_modules/next/dist/docs/01-app/02-guides/
backend-for-frontend.md` → "Caveats" → "Server Components"). `shared/api/
server/fetchBackend()` is that direct path: it calls `apps/api` via
`process.env.API_URL` (the same variable `authenticated-proxy.ts` already
uses for its own outbound call), reusing rather than duplicating the BFF's
session-vault token resolution, trusted-client-IP relay (ADR-072), and
outbound header allowlist.

`fetchBackend(path, schema, { auth, timeoutMs?, signal?, tokenResolver? })`
never throws for a _known_ availability failure (`429`/`5xx`/timeout/network)
or a real `404` — it returns a closed `DataOutcome<T>` (`'success' |
'not-found' | 'unavailable'`) instead, validated against the caller's Zod
`schema`. `auth` is required on every call (`'none'` never touches the
session vault — safe for a public read even when Redis is down;
`'optional'`/`'required'` differ only in whether a genuinely logged-out
caller proceeds anonymously or gets a `BackendAuthRequiredError`).
`tokenResolver` overrides the product-session token source for a caller
with its own isolated session domain. Omit it for every ordinary product call; the
default resolves the product session exactly as before, and a custom
resolver never falls back to it, even when it resolves `null`.

The optional Operations Console supplies this override through
`shared/api/console/access-token.ts`'s `getConsoleAwareAccessToken`
(ADR-081's host/path session split).

`degradeSecondary()`/`resolvePrimary()` turn a
`DataOutcome` into what a page actually renders — both are ordinary render
branches, never a throw: a secondary section degrades silently (logged
once, server-side), and primary content renders an explicit unavailable
outcome for the caller to show as a localized fallback + retry, also logged
once, also without ever crossing an error boundary. `catchError`/
`instrumentation.ts`'s `onRequestError` are reserved for genuinely
unexpected exceptions, not this known-failure path. The full pattern this
composes into — primary vs. secondary sections, the fallback UI, localized
copy — is [Server-rendered graceful degradation](./server-rendered-resilience.md).

## Retry policy: 429 and `Retry-After` (ADR-073)

`getQueryClient()`'s `defaultOptions.queries` (`shared/api/query-client.ts`)
supplies the default retry policy unless a resource overrides it — TanStack
Query's own default retries _any_ error up to 3 times, including a genuine
client-input error (400/404/422/...) that will never succeed unchanged.
This starter's default instead:

- **Never retries a 4xx, except 429.** A rate-limit refusal is retryable by
  definition ("try again later"); every other 4xx means the request itself
  is wrong and retrying it changes nothing.
- **Retries a 429 up to 3 times, honouring a real `Retry-After` header**
  (RFC 9110) when the backend sent one — `apps/api`'s global rate limiter
  always does (ADR-073). `ApiRequestError.retryAfterSeconds`
  (`http-client.ts`) captures it; `getRetryAfterMs()` (`errors.ts`) reads
  it back. No `Retry-After` (a 429 from somewhere else, or a 5xx/network
  error) falls back to TanStack Query's own exponential backoff.
- `<ApiErrorAlert>`/`useApiError()` already localize `RATE_LIMIT_EXCEEDED`
  in both catalogues — nothing else to wire up for a query that exhausts
  its retries and surfaces the error to a component.

A Route Handler or API-proxy request that cannot be admitted because the session vault is
slow or unreachable answers `503` with `errorCode` `SERVICE_UNAVAILABLE` and keeps the session;
the default Query policy can retry this 5xx, while organization access readers require explicit recovery. Details:
[Authentication when Redis is slow or unavailable](../auth/redis-outage.md#the-web-servers-session-vault).

Only `useQuery`/`useInfiniteQuery` are affected — `useMutation` never
retries by default in TanStack Query, and this starter doesn't override
that.

Organization access readers disable automatic retries, focus refetch and reconnect
refetch. A failed resource waits for explicit recovery and honors its cached
`Retry-After`, including after remount. Authority revalidation has separate
focus/visibility/restored-page handling.

## Data ownership for interactive pages

Use TanStack Query for browser-owned server data. Keep the typed transport
responsible for HTTP, session handling, validation and error codes. Do not add
a second request cache or loading state machine around Query.

| Data owner                | Starting pattern                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Server display            | Server Component and existing server DAL; URL navigation or route refresh updates the result.   |
| Ordinary interactive data | Typed transport and Query hook; form input stays local; writes update affected keys.            |
| Query with domain rules   | The same Query ownership, plus only required authorization, secret or operation-recovery rules. |

Server initial data is optional. Use request-local Query hydration when it improves
an initial view; a dialog or adequate client-loaded list does not need it merely
for consistency. Version checks and confirmation belong to forms whose API or
consequences require them, not every ordinary edit.

### Short-lived identity suggestions

Use `IdentityLookup` from `@/shared/ui/identity-lookup` to select a person or
organization from suggestions. Mount it under your existing `QueryClientProvider`;
standalone consumers must supply that provider too. Pass localized copy, `onSelect`
and `searchItems(term, signal?)`, returning `{ items, hasMore }`. Forward the signal
to your typed transport when supported; existing one-argument callbacks remain valid.

Query owns results, errors and loading. The field keeps input, debounce and dismissal
local: two trimmed characters, 400 ms or Enter, and explicit Enter retry after failure.
Editing hides old results immediately. Each field and edit has a separate query key;
unused entries use `gcTime: 0`. There is no shared suggestions cache or background
refresh. Collection is scheduled, not synchronous secure erasure; abort cannot undo
server work. A callback identity change does not restart the search. When replacing
the data source, remount with a React `key` identifying that source. Selection returns
an ID; the feature owns navigation or subsequent writes. URL-backed list search uses
the separate [search primitives](./search/README.md).

### Start with an ordinary resource

Notification preferences already have typed transport and Query hooks in
`entities/notifications/api/`. The following **documentation example** shows their
list/edit lifecycle; AMCore does not include a ready preferences screen. It is
form logic for a downstream UI, not a new shared wrapper.

Supply QueryClientProvider and the `common`, `errors` and form localization
messages. The host below reads the confirmed session, handles its prerequisite
states and remounts the form when its owner changes. The `render` callback supplies
your list/dialog UI; it receives the form logic shown below. No screen is shipped.

```tsx
'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { type NotificationPreferenceItem, updateNotificationPreferenceSchema } from '@amcore/shared'
import {
  useNotificationCapabilities,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '@/entities/notifications'
import { useCurrentUser } from '@/entities/user'
import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import { type QueryOwner, queryOwner } from '@/shared/api/query-session'
import { useLocalizedForm } from '@/shared/hooks/use-localized-form'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

type PreferenceView = (model: ReturnType<typeof usePreferenceExample>) => ReactNode

export function PreferenceExampleHost({ render }: { render: PreferenceView }) {
  const me = useCurrentUser()
  const owner = queryOwner(me.data)
  const t = useTranslations('common')
  if (!owner) {
    if (me.isPending || me.isFetching) return <p role="status">{t('loading')}</p>
    const error = me.error ?? new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
    return (
      <>
        <ApiErrorAlert error={error} />
        <Button onClick={() => void me.refetch()}>{t('retry')}</Button>
      </>
    )
  }
  return (
    <PreferenceSession
      key={JSON.stringify([owner.userId, owner.contextSession])}
      owner={owner}
      render={render}
    />
  )
}

function PreferenceSession({ owner, render }: { owner: QueryOwner; render: PreferenceView }) {
  return render(usePreferenceExample(owner))
}

export function usePreferenceExample(owner: QueryOwner) {
  const list = useNotificationPreferences(owner)
  const capabilities = useNotificationCapabilities()
  const save = useUpdateNotificationPreference(owner)
  const [editing, setEditing] = useState<NotificationPreferenceItem | null>(null)
  const form = useLocalizedForm(updateNotificationPreferenceSchema)
  const canEdit = (row: Pick<NotificationPreferenceItem, 'category' | 'channel'>) =>
    !list.isError &&
    !capabilities.isError &&
    capabilities.data?.categories.some(
      (item) => item.category === row.category && item.overridableChannels.includes(row.channel)
    ) === true

  function edit(row: NotificationPreferenceItem) {
    if (save.isPending || !canEdit(row)) return
    save.reset()
    setEditing(row)
    form.reset({ category: row.category, channel: row.channel, enabled: row.enabled ?? undefined })
  }
  const submit = form.handleSubmit((input) => {
    if (!editing || save.isPending || !canEdit(input)) return
    save.mutate(input, { onSuccess: () => setEditing(null) })
  })
  return {
    list,
    capabilities,
    editing,
    form,
    save,
    edit,
    submit,
    canEdit,
    cancel: () => {
      if (!save.isPending) setEditing(null)
    },
    optionalDeliveryOff: list.data?.notificationsEnabled === false,
  }
}
```

Render `list.data.preferences` as rows after handling pending/error states. Use
capabilities to gate Edit. Bind the form's `enabled` field to an explicit boolean
choice; keep category/channel as the selected row's identity. Disable submission
while saving. Show localized validation and API errors with the shared controls.
The selected row is captured only on Edit: a background refetch must not reset
unfinished input. Cancel discards the draft; reopening uses the latest row.

Display `enabled: null` as **Default**, not disabled. The API accepts only a boolean
write, so the user must choose before saving; there is no reset-to-default operation.
When `optionalDeliveryOff` is true, explain that the general switch disables optional
notifications even if this preference is enabled. Editing remains possible.
`mandatory` describes delivery, not editability: a mixed category can still have
optional definitions. Follow `overridableChannels`; mandatory delivery bypasses the
override. See [Preferences and mandatory channels](../notifications/README.md#preferences--mandatory-channels).

`useUpdateNotificationPreference` calls the existing typed PUT transport and, on
204 acknowledgment, schedules invalidation of `notificationKeys.preferences(capturedOwner)`
without awaiting the refetch. The form can close on success while the list shows
`isFetching`. A failed follow-up GET belongs to `list.error`; offer `list.refetch()`
and keep the saved outcome. Do not repeat PUT to recover a list-read failure.
Feed, unread count and capabilities are not dependencies of this write.

A failed PUT retains input and `save.error`. A network/5xx failure can leave the
write outcome unknown: offer a fresh read and an explicit later save, never an
automatic replay. This API overwrites one preference; it has no version or receipt
protocol. A refreshed list must not silently discard an open draft.

The example is type-checked against the existing exports. Narrow HTTP-mocked hook
tests check acknowledgment before a delayed/failed refetch and read-only recovery;
they do not prove a rendered form. Separate hook tests cover the subscribed
session transition; this example still requires your own UI verification. Anonymous
users must sign in through the host's existing entry; Retry only rereads the session.
No notification controller, operation journal or extra loading state is needed.

For optional initial server data, use the entity's server DAL with request-local
QueryClient and matching keys. Never call the relative browser client from the
server or serialize secrets. Public resources need an explicitly anonymous backend
transport/BFF route: the generic notification proxy requires a session. Public
keys must include inputs such as locale that affect the response. Existing ordinary
list/write consumers also include `entities/user/api/user-queries.ts` and session
revocation features.

### Personal data and session changes

Own sessions, notification feeds/counts/preferences and AI reads use keys under
`['personal', contextSession, userId, ...resourceInputs]`. `contextSession` is a
non-secret server binding, not an access token. A user ID alone cannot distinguish
two sign-ins by the same person. Public data needs only its response inputs.

`useCurrentUser()` keeps the stable `['user', 'me']` query. Login, registration and
invitation acknowledgment publish the confirmed envelope on that query. Its
notification switches dependent readers; ordinary me refetch also detects a changed
session. Obsolete personal queries are cancelled and removed. Same-session data
stays cached. Sessions reuse previous-page data only for the same owner/session/locale.
With an empty cache, the personal GET follows me; there is no speed guarantee here.

Use `userKeys.sessionsAll(owner)` / `sessions(owner, locale, page, limit)` and
`notificationKeys.preferences(owner)`. `userKeys.all` no longer matches sessions;
`notificationKeys.all` matches only the registry, not feed/count/preferences. Use the captured owner's
resource key after a write, not the entire personal prefix. Preferences hooks take
an owner argument; their mutation DTOs are unchanged. Missing/mismatched ownership
rejects a preference write before transport. Reads accept null and stay disabled.
Both session-revoke hooks also reject writes without a confirmed owner. The bulk
revoke button and its confirmation wait for that owner, not for background refresh.

Writes capture the initiating owner and current-user Query. Late success remains
success, but cannot update the replacement session's cache. Avatar and locale merges
preserve the current-user envelope. A keyed form subtree drops the old owner's draft;
a same-owner background refresh keeps it. Cancellation does not undo server writes.
This is not atomic protection against another tab changing cookies at dispatch,
nor a general offline-paused mutation guarantee. The notification feed and AI actions below
recheck ownership before paused dispatch. Never replay an uncertain write automatically.

`useSessions(page, limit)` composes bootstrap and list states. It returns `data`,
`error`, `isPending`, `isFetching`, `isError`, `isSuccess` and an async
`refetch(): Promise<void>` recovery action, not the full raw Query result. Without
an owner, refetch retries me; normal key activation then loads the list. A failed
or completed unusable bootstrap is an error, not endless list loading.

The personal-key contract covers sessions, notification feeds/counts/preferences
and the AI hooks below. It does not certify every private export. Other consumers
retain their host/session requirements. Organization access has the separate domain contract below.

### Organization access: additional domain requirements

Organization invitations and members demonstrate initial hydration in
`src/_app/organization-access/ui/{invitations,members}-mount.tsx`. Each mount creates
its own QueryClient, reads admission and the actual list envelope, seeds the exact
browser keys, and serializes only safe data. Do not put a server QueryClient
in a module singleton or hydrate credentials, receipts or one-time secrets.
Keep the existing authentication/error mapping around the DAL.

Invitation, member and role resource keys use `[resourceName, JSON.stringify([binding, orgId, input])]`.
The binding identifies the session; input includes filters, page and any member/role
identifier. Server and browser must construct identical inputs. Authority keys also
include locale. Import hooks through the entity public API; server compositions use
its explicit `index.server.ts` entry.

For example, a component inside an admitted organization composition can reuse
the invitation resource without another loader:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import {
  type OrganizationAccessController,
  useOrganizationInvitations,
} from '@/entities/organization-context'

export function InvitationCount({ controller }: { controller: OrganizationAccessController }) {
  const t = useTranslations('organizationInvitations')
  const list = useOrganizationInvitations(controller, {
    page: 1,
    search: '',
    status: 'pending',
    limit: 20,
  })
  if (!list.available || !list.data) return null
  return <p>{t('count', { count: list.data.total })}</p>
}
```

This secondary count relies on the owning page to show loading/errors and provide
the `organizationInvitations` message namespace. For a primary list, follow the
existing widget's skeleton, error/retry, empty state and pagination.

### Display, permission and form intent

Organization resources use a 60-second freshness window. A second observer can
reuse a fresh result; attaching it does not require a new request. Stale observed
resources follow Query's mount/enabling behavior. Background fetching can keep
existing data visible. `pending` describes an initial read; `fetching` also covers
background refresh. A settled error makes the resource unavailable until recovery.
Expiration of `Retry-After` alone does not initiate a request.

Fresh data is not a permission lease. Admission, handler readiness and resource
availability are separate. These two page compositions reuse fresh server admission;
focus, visibility return and persisted-page restoration still revalidate it.
Known resource 401/403/409 responses revoke scoped admission before another owner
can reuse it. The server still authorizes every command. Disable event-driven
controls in server HTML until their browser handlers attach.

Keep dirty forms based on their original version. Background results must not
silently replace selections or confirm destructive actions. The member role form
uses `review()`, which requires an uncancelled fresh observation. Ordinary
`refresh()` can retain Query's cached fallback on cancellation; it is not proof
of a completed review. Each form defines what successful review resets.
Invitation generation review preserves roles and clears confirmation. Temporary
authority checks hide the member form while preserving its draft.

### Refresh the dependencies of a write

| Command                          | Dependencies in the current organization/session                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Invitation create/reissue/revoke | Invitation lists and role details with invitation-impact counts                                   |
| Member role replacement          | Member lists/role assignments, role details/lists and member access; also refresh actor authority |

The shared implementation cancels superseded reads before invalidating these keys.
It invalidates before checking authority, so a failed authority check cannot leave
known-old dependencies fresh. Only the subsequent network reads require authority.
Inactive entries remain invalidated until observed. Observed entries use explicit
typed resource functions and obey cooldowns. Do not replay arbitrary cached
observer options, which may contain `skipToken`. Retain successful acknowledgment
when a follow-up read fails. Recover the read without resending the write.
Invitation commands keep their stable operation ID and receipt-based recovery.

Legacy role create/edit/delete, member removal and member-key revocation first
invalidate organization resource entries for the current session and organization,
including inactive entries and nested member-key keys. They then retain their
existing authority check and registered-reader refresh. This conservative scope
deliberately covers cross-resource revision/access effects and preserves
compatibility. It is a supported broad policy, not an unfinished narrow migration.
For member-key revocation alone, the broad scope is a deliberate compatibility
tradeoff: that operation does not change roles, membership or ACL revision.
These resource and command hooks require the application QueryClientProvider.
For each new command, identify dependencies and actor-permission effects in the
entity, not separately on each page. See [state conventions](./architecture-and-conventions.md#state-model)
and [verification](./testing.md#interactive-data-ownership).

## Server request boundary

Use `fetchBackend(path, schema, { auth: 'required' })` for ordinary server reads
that need the existing DataOutcome contract. Its request-scoped header builder
calls Next's `await headers()` and passes that original source to the sender;
the read caller does not supply or fabricate a source. A browser feature uses the existing
same-origin apiClient. Keep specialized handlers for cookies, OAuth, streams,
proofs and compensation; they own session selection and response parsing.

Use the existing `handleLogout` from `shared/api/bff/logout-handler` for ordinary
product logout. It checks browser origin, selects the scoped vault session,
revokes upstream without refresh, deletes that vault entry and clears the browser
cookie even when upstream fails. Host Console retains its separate handler and 204.
The following example explains only transport; it is not a replacement logout flow.

A specialized server handler sends through `fetchBackendResponse`:

```ts
import { fetchBackendResponse } from '@/shared/api/backend-transport'

const response = await fetchBackendResponse('/api/v1/auth/logout', request.headers, {
  method: 'POST',
  headers: { Cookie: `refresh_token=${serverHeldRefreshToken}` },
  signal: AbortSignal.timeout(5000),
})
```

Pass original request headers as the required second argument. Server Components
obtain them with `await headers()` from next/headers. Select outgoing headers
explicitly; do not copy all inbound headers. The sender clones that selection,
strips IP lookalikes, then adds the configured visitor claim. It preserves selected
cookies/proofs, streams, signals and cache options. Use `getBackendBaseUrl()` for
existing domain URL builders; do not read API_URL elsewhere.

The target must be a root-relative path or same-API-origin HTTP(S) URL. Request
objects, URL credentials, scheme-relative URLs and other origins are rejected.
Redirect following is forbidden, including same-origin redirects. The default is
`redirect: 'error'`; handlers return their controlled availability response on an
unexpected redirect. Only the existing OAuth proxy and queue board use `manual`
and handle the response themselves. Never follow Location with internal headers.

### Enforced scope and limits

Paired lint guards runtime source in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs`. Only test/spec/
stories files, declaration files and src/test are excluded. Direct global fetch,
static `.fetch` access/destructuring, API_URL property reads, common alternate HTTP
imports and literal loaders fail. Importing the safe helper does not exempt a
second raw fetch. A local function named fetch remains legal; a local `.fetch`
property is deliberately reserved.

Run `node scripts/lint.mjs --scope web` to see diagnostics. ESLint reports
`no-restricted-globals`, `no-restricted-properties`, `no-restricted-imports` or
`no-restricted-syntax`, naming the safe helper and this guide.

The exact raw-fetch adapters live in apps/web/network-policy.mjs. Only the backend
sender reads API_URL. Browser adapter exceptions relax fetch alone, retain all
other guards and require review for changes. A new external SDK adapter needs a
narrow reviewed exception and tests; never send internal claims/auth to it.

Lint does not trace arbitrary SDKs, cross-file aliases, computed module/property
names, injected functions or source-header provenance. It is a diagnostic guard,
not a network sandbox. Review deployment trust and each specialized handler.

## Client-IP relay to `apps/api` (ADR-072)

The generic authenticated proxy (`authenticated-proxy.ts`) never relays a
browser-supplied `X-Forwarded-For`/`X-Real-IP`/`Forwarded`/etc. header to
`apps/api` — `proxy-headers.ts`'s `forwardRequestHeaders()` strips every
forwarded/client-IP lookalike unconditionally, regardless of configuration.
This is always on, not opt-in.

Separately, `apps/web` can optionally relay the _real_ visitor IP to
`apps/api` as a purpose-specific `X-AMCore-Client-Ip` header, derived by
`trusted-client-ip.ts`'s `resolveTrustedClientIp()` from a single inbound
header you name via `WEB_TRUSTED_CLIENT_IP_HEADER` (`.env.example`) —
**disabled by default**. Turning it on is an assertion that whatever edge
proxy/LB sits directly in front of `apps/web` itself overwrites (never
appends to) that header before it reaches `apps/web`; Next.js Route
Handlers/Proxy expose no raw socket address to verify a hop's identity
against, unlike `apps/api`'s `TRUST_PROXY` (ADR-060), so this is
trust-by-header-name only.

On the `apps/api` side, the global `RateLimitGuard`'s tracker resolver
(`client-tracker.ts`, ADR-039/ADR-073) trusts the relayed header only when **both**
(a) `TRUSTED_WEB_PEERS` is configured (`.env.example`) **and** (b) the
inbound request's _actual_ socket peer — `req.socket.remoteAddress`, never a
forwarded header, and independent of Fastify's `TRUST_PROXY` — is in
that trusted set (real IPv4/IPv6 CIDR matching via Node's built-in
`net.BlockList`). Either half missing → falls back to stock `req.ip`,
identical to pre-ADR-072 behavior; a request that never went through
`apps/web` at all (a direct API-key/OAuth caller) is unaffected either way.

**Both env vars must be set together** to get an effect —
`WEB_TRUSTED_CLIENT_IP_HEADER` (which inbound header `apps/web` trusts) and
`TRUSTED_WEB_PEERS` (which socket peer `apps/api` trusts) are independent
knobs on independent trust boundaries, not one setting. `getClientIp()`/
audit-log IP and invite-abuse remain scoped to their existing inputs. Password login
and step-up explicitly use the peer-verified visitor address, then req.ip/socket
fallback. This does not rewrite global req.ip or expand audit/invite trust.

Safe use also requires every edge in front of `apps/api` to strip
`X-AMCore-Client-Ip`, and `TRUSTED_WEB_PEERS` to name the exact `apps/web`
address, never a range that also covers the edge. See
[BFF client-IP relay](../operations/deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy).

Session metadata capture uses the same actual-peer validation for registration,
password login, OAuth login callbacks and refresh. The BFF forwards descriptive
UA and derives the internal IP claim from the configured edge header for each
request, including all refresh entry points (product DAL, generic proxy, own
sessions handler and console helper). It never copies an inbound internal claim.
A missing UA is explicitly empty on transport and null in storage, avoiding
Node fetch's default device label. Refresh metadata comes from the request that
wins the vault lock; waiting requests reuse the resulting generation. Password
login keeps a separate Session metadata address field; password accounting
uses the explicitly selected verified visitor address. None of this metadata authorizes a request.

The reference `docker-compose.yml` supports this: `api`'s published port
binds to `127.0.0.1` by default (not `0.0.0.0`, ADR-072), so the only path
to `apps/api` from outside the compose host is through whichever edge you
run — see `docs/operations/deployment.md` → "BFF client-IP relay" for the
full topology reasoning and the `API_PUBLISH_HOST` override for a
non-default network setup.

## What is enabled by default vs. reference-only

The starter includes two different kinds of frontend surface:

- **Default UI:** email/password login and registration, the full
  password-reset/email-verification email-link flow (`/forgot-password`,
  `/reset-password`, `/verify-email`, `/resend-verification` — the
  backend has supported these since the auth foundation was built; the
  frontend reference flows landed later), Google OAuth entry point when the
  backend reports Google as configured, logout, current-user reads/updates,
  locale switching, and the active-sessions page at
  `/{locale}/settings/sessions`.
- **Reference consumption hooks, deliberately no product UI:** avatar
  upload/delete, notifications feed/preferences/realtime, and AI
  conversations/runs/messages. These hooks are production-quality examples
  of how a downstream product should consume the backend through the BFF,
  but AMCore does not guess the product UI that should sit on top of
  notifications or AI — that would mean inventing a UI shape with no real
  consumer driving it, exactly the kind of speculative design this starter
  avoids elsewhere. This is a standing decision, not a placeholder waiting
  to be filled in: `entities/ai`/`entities/notifications` having zero
  internal consumers in `apps/web` is intentional, confirmed at Track 9's
  closeout, not an oversight to "finish." Build the product UI in the
  owning product slice and reuse the hooks below.

## Media — avatar upload/delete

The only shipped media consumer is the user entity's avatar field
(`docs/media/README.md`, `docs/media/configuration.md`). It's not a separate
domain slice — `entities/user/api/user-queries.ts` exposes `useUploadAvatar()`
/ `useDeleteAvatar()` alongside `useCurrentUser()`, both merging the result
into the cached current user (`userKeys.me()`) instead of a separate cache
entry.

```ts
const { mutate: upload } = useUploadAvatar()
upload(file) // File from an <input type="file">
```

Uploading needs a `multipart/form-data` body, which `shared/api/http-client.ts`
didn't support until this surface needed it — `apiClient.postForm(path, formData)`
sends the `FormData` object with **no** manually-set `Content-Type`; the
browser sets its own `multipart/form-data; boundary=...`, which a header set
ahead of time would silently break.

## Notifications

`entities/notifications` wraps the feed, unread count, and preferences
surface (`docs/notifications/README.md`):

- `useNotificationsFeed(owner, limit)` — `useInfiniteQuery` over the cursor envelope
  (`{ data, nextCursor, hasMore }`, ADR-036 keyset pagination — not `page`/`total`).
- `useUnreadCount(owner)`, `useNotificationPreferences(owner)`,
  `useNotificationCapabilities()` — plain queries. Capabilities is the active
  channel/category registry (ADR-052): a preferences UI reads it to render
  which channels/categories exist and which are user-overridable, rather than
  hardcoding a set that can go stale or advertise a dead channel.
- `useMarkNotificationRead(owner)`, `useMarkAllNotificationsRead(owner)`,
  `useArchiveNotification(owner)`, `useUpdateNotificationPreference(owner)`,
  `useUpdateNotificationSettings(owner)` — mutations; pass the notification ID to mark-read/archive `mutate(id)`,
  no argument to mark-all `mutate()`, or the preference/settings DTO to `mutate(input)`. Each invalidates
  exactly the query keys its endpoint can affect (the feed/unread-count pair,
  or preferences — never both).
- `useNotificationsStream(owner, enabled)` — realtime; see below.

All notification hooks require `QueryClientProvider`. Derive the owner from the
subscribed current-user query; do not construct it from a user ID or token.
This is a composition example, not a shipped feed screen:

```tsx
'use client'

import {
  useNotificationsFeed,
  useUnreadCount,
  useMarkNotificationRead,
  useNotificationsStream,
} from '@/entities/notifications'
import { useCurrentUser } from '@/entities/user'
import { queryOwner } from '@/shared/api/query-session'

function useNotificationExample() {
  const owner = queryOwner(useCurrentUser().data)
  const feed = useNotificationsFeed(owner, 20)
  const count = useUnreadCount(owner)
  const markRead = useMarkNotificationRead(owner)
  useNotificationsStream(owner)
  return { owner, feed, count, markRead }
}
```

A null owner disables automatic reads and the stream; reads/writes also check
ownership before transport. Disable actions until an owner is available. Feed
mutations keep their initiating session even when offline pause delays dispatch.
Successful POST acknowledgment completes the mutation independently of refresh.
A refresh error requires retrying the GET, not repeating a successful POST.
For local work after `await mutateAsync(...)`, call `captureQuerySession(client)` before awaiting
and check `isCurrentQuerySession` before closing/resetting the current form.

Custom invalidators use `notificationKeys.owned(owner)` for feed plus count,
`feedAll(owner)` for all page sizes, `feed(owner, limit)` for one list, or
`unreadCount(owner)` for count only. Preferences use their separate key;
`notificationKeys.all` covers only the registry. Confirmed feed writes and stream
open/message hints cancel old owned reads before invalidating; active queries
refetch, inactive variants become stale. The owner is checked again after cancellation.
Query passes AbortSignal to feed/count transport; direct adapter callers may omit it.

## AI — conversations, runs, messages

The seven `entities/ai` hooks require `QueryClientProvider` and a confirmed
user/session owner: `useCreateAiConversation(owner)`, `useAiConversation(owner, id)`,
`useCreateAiRun(owner)`, `useAiRun(owner, runId)`, `useCancelAiRun(owner)`,
`useAiMessages(owner, conversationId)` and `useAiRunStream(owner, run, enabled)`.
Read IDs and the stream pair may be null before selection; automatic reads/stream
stay disabled. Forced reads and commands still check owner admission before HTTP.

This documentation example composes the existing hooks, not a shipped AI screen.
Mount its local selection/input subtree with a key derived from the current
owner/session, so replacement discards old drafts and selected IDs. Obtain the
run pair from that owner's run GET or acknowledged creation, never invent it.

```tsx
'use client'

import type { AiRunResponse, CreateAiRunInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAiConversation,
  useAiMessages,
  useAiRun,
  useAiRunStream,
  useCancelAiRun,
  useCreateAiConversation,
  useCreateAiRun,
} from '@/entities/ai'
import { useCurrentUser } from '@/entities/user'
import { captureQuerySession, isCurrentQuerySession, queryOwner } from '@/shared/api/query-session'

function useAiExample(
  conversationId: string | null,
  selected: Pick<AiRunResponse, 'id' | 'conversationId'> | null
) {
  const client = useQueryClient()
  const owner = queryOwner(useCurrentUser().data)
  const conversation = useAiConversation(owner, conversationId)
  const messages = useAiMessages(owner, conversationId)
  const run = useAiRun(owner, selected?.id ?? null)
  const createConversation = useCreateAiConversation(owner)
  const createRun = useCreateAiRun(owner)
  const cancel = useCancelAiRun(owner)
  useAiRunStream(owner, selected)
  async function start(input: CreateAiRunInput, select: (run: AiRunResponse) => void) {
    const captured = captureQuerySession(client)
    const created = await createRun.mutateAsync(input)
    if (isCurrentQuerySession(client, captured)) select(created)
  }
  return { owner, conversation, messages, run, createConversation, createRun, cancel, start }
}
```

Keep `conversationId` and `selected.conversationId` aligned in the caller. Disable
commands until owner/selection is ready. Create DTOs are unchanged: `inputParts`
contains structured content parts. Cancel now takes the original run pair through
`cancel.mutate({ id, conversationId })`; the HTTP endpoint still receives only id.
Apply the same captured-session check after awaiting conversation creation before
changing local selection/navigation. While a command is pending, either prevent
selection changes or check the initiating selection before updating local input.
These local checks are separate from the hooks' protection of cache dependencies.

`aiKeys.all(owner)` is now an owner-qualified factory, not a static array.
`conversation(owner, id)`, `run(owner, id)` and `messages(owner, conversationId)`
are the resource factories. Creation/cancel and stream hints refresh only the
initiating run and transcript: cancel older reads, recheck the captured session,
then invalidate exact keys. Other conversations, metadata and owners stay untouched.
No run or message is seeded from a write/SSE payload. Optional GET signals remain
compatible with direct adapter callers. Delayed commands recheck ownership before
POST; a dispatched write can finish without affecting a replacement session.

A successful write completes independently of subsequent GETs. A failed refresh
needs GET-only recovery, not a repeated successful POST. Cancel may return
`status: 'running', cancellationRequested: true`; this acknowledges a request,
not worker termination. Retain the backend's unknown-result/idempotency rules.

Messages use oldest-first numeric sequence cursors. Refresh rereads loaded pages:
an append within their capacity appears there; an append beyond a full last page
exposes `hasNextPage`. Call `fetchNextPage()` to load that page. This is not automatic
tail-following or token streaming. Stream open/matching status hints refresh both
run and messages from HTTP; dropped hints recover on reconnect or explicit refresh.
Future real AI UI composition needs runtime verification. These hooks do not make
unobserved cross-tab cookie changes atomic or implement persisted command replay.

## Realtime: why `EventSource` is enough here

Both `docs/notifications/README.md` and `docs/ai/runs.md` say a **direct**
backend SSE consumer needs a custom `fetch`-based stream reader, because the
stream is bearer-only and `EventSource` cannot set an `Authorization` header.
That guidance is correct for a client talking to `apps/api` directly — it
just doesn't apply to `apps/web`, because the browser here never holds a
bearer token at all. A request to a relative, same-origin URL like
`/api/notifications/stream` sends only the `amcore_session` cookie
(automatic for same-origin, which is what `withCredentials: true` opts into);
the generic BFF proxy resolves the real access token from the Redis vault and
attaches it upstream, exactly as it does for every other proxied call.

So `shared/api/sse/use-event-source.ts` wraps native `EventSource` instead of
a custom reader. The following shows its options; use the notification wrapper
above for its captured-owner refresh implementation:

```ts
useEventSource({
  url: '/api/notifications/stream', // relative + same-origin — never an apps/api URL
  schema: notificationSseEventSchema, // shared Zod schema; an unparseable frame is dropped, not trusted
  connectionKey: JSON.stringify([owner?.contextSession, owner?.userId]),
  enabled: !!owner,
  onOpen: refreshOwned, // cancel old reads, recheck captured owner, then invalidate
  onEvent: refreshOwned, // content-free hint: "something changed", never the new state itself
})
```

`useNotificationsStream(owner, enabled)` and `useAiRunStream(owner, run, enabled)` are both thin
wrappers over this: both cancel older captured-owner reads before invalidation.
AI refreshes its run/transcript pair; notifications refresh feed/count. They refresh the relevant
TanStack Query key(s), never write the event payload into the cache
directly — Postgres (fetched over plain HTTP) stays the source of truth,
matching the "content-free hint" design both backend surfaces already
document. `EventSource`'s own automatic reconnect covers the "stream closes
at token expiry, client reconnects" behavior the backend enforces
server-side.

The optional `connectionKey` reconnects when identity changes at the same URL.
Notification streams supply the non-secret owner/session pair. Null ownership
closes the connection; saved obsolete handlers cannot invoke a new owner's callbacks.
Same-identity callback/schema updates keep the connection. Other callers may omit
`connectionKey`; URL/enabled changes still close and replace the connection.
This does not detect an unobserved cookie change in another tab.

The "always a relative `/api/...` path" rule isn't just a comment — the hook
throws at connect time if `url` doesn't start with `/api/`, so an absolute or
protocol-relative URL (which would bypass the BFF and hit `apps/api` directly,
where `EventSource` can't attach the required `Authorization` header) fails
loudly instead of silently shipping a broken connection.

## Testing these hooks

Frontend mocks always target `/api/*` BFF paths, never `apps/api` directly —
matches the "one rule everything below follows" above. A component/
integration test intercepts `/api/notifications/*`, `/api/ai/*`, etc.
(`msw/node`'s `setupServer()`); an E2E test mocking a server-side fetch this
page describes (e.g. `getOAuthProviders()`) uses Next's
`experimental/testmode/playwright/msw` fixture instead, since `page.route()`
never sees a request that never crosses the browser. See
[Testing](./testing.md) for the full taxonomy.

## See also

- [Architecture & conventions](architecture-and-conventions.md#browser-api-reach) —
  the BFF Route Handler layer and the auth flows built on it.
- [Backend rate limiting](../backend/architecture-and-conventions.md#cross-cutting-decision-points) —
  the `@RateLimit`/`@SkipRateLimit` policies and GCRA algorithm this page's
  retry policy responds to.
- [Testing](./testing.md) — which layer to test a given hook/flow at.
- [Media](../media/README.md), [Notifications](../notifications/README.md),
  [AI](../ai/README.md) — the backend contracts these hooks consume.

## Own API-key adapter

The ready [own-key flow](../product-admin/own-api-keys.md#browser-and-api-contracts) uses
dedicated `/api/own-api-keys` handlers with strict input, binding, byte budgets and
exact success acknowledgments. Its session probe uses only vault/refresh. A fresh
post201 probe precedes secret reveal. Creation bypasses Query/MutationCache.
The generic `/api/api-keys` path and its accepted aliases remain supported; the
JWT-containment classifier does not block API-key issuance. Generic traffic does
not acquire the dedicated adapter’s validation or client lifecycle guarantees.
