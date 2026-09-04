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

A dedicated route is worth adding for two distinct reasons, not one:

- **The backend needs something the generic proxy can't forward.**
  `/auth/sessions*` needs the raw `refresh_token` cookie to identify the
  caller's own session, which the generic proxy never sees.
- **The caller has no session at all.** The generic proxy requires an
  existing `amcore_session` cookie and 401s without one — unusable for
  login/register (nothing to be a session of yet) or the four email-link
  auth actions (`forgot-password`, `reset-password`, `verify-email`,
  `resend-verification` — a user resetting a forgotten password isn't
  logged in, and a verification link may be opened in a browser holding no
  cookies at all). `credential-auth-handler.ts` covers the first two
  (mints a session from the backend's `refresh_token`);
  `public-auth-action.ts` covers the latter four (forwards the backend's
  response verbatim, mints nothing — none of them authenticate anyone).

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
forwarded header, and independent of Express's own `TRUST_PROXY` — is in
that trusted set (real IPv4/IPv6 CIDR matching via Node's built-in
`net.BlockList`). Either half missing → falls back to stock `req.ip`,
identical to pre-ADR-072 behavior; a request that never went through
`apps/web` at all (a direct API-key/OAuth caller) is unaffected either way.

**Both env vars must be set together** to get an effect —
`WEB_TRUSTED_CLIENT_IP_HEADER` (which inbound header `apps/web` trusts) and
`TRUSTED_WEB_PEERS` (which socket peer `apps/api` trusts) are independent
knobs on independent trust boundaries, not one setting. `getClientIp()`/
audit-log IP and the invite-abuse limiter are **not** wired to this — they
remain scoped to `req.ip` exactly as before; extending them is a deliberate,
separately-reviewed future decision, not an implicit side effect.

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

- `useNotificationsFeed(limit)` — `useInfiniteQuery` over the cursor envelope
  (`{ data, nextCursor, hasMore }`, ADR-036 keyset pagination — not `page`/`total`).
- `useUnreadCount()`, `useNotificationPreferences()`,
  `useNotificationCapabilities()` — plain queries. Capabilities is the active
  channel/category registry (ADR-052): a preferences UI reads it to render
  which channels/categories exist and which are user-overridable, rather than
  hardcoding a set that can go stale or advertise a dead channel.
- `useMarkNotificationRead(id)`, `useMarkAllNotificationsRead()`,
  `useArchiveNotification(id)`, `useUpdateNotificationPreference(input)`,
  `useUpdateNotificationSettings(input)` — mutations, each invalidating
  exactly the query keys its endpoint can affect (the feed/unread-count pair,
  or preferences — never both).
- `useNotificationsStream()` — realtime; see below.

## AI — conversations, runs, messages

`entities/ai` wraps the minimal flow `docs/ai/README.md` documents:
create a conversation, create a run, observe it, read the transcript.

```ts
const { mutateAsync: createConversation } = useCreateAiConversation()
const { mutateAsync: createRun } = useCreateAiRun()

const conversation = await createConversation({})
const run = await createRun({
  conversationId: conversation.id,
  inputParts: [{ type: 'text', text: 'Hello' }],
})
// useAiRun(run.id) / useAiRunStream(run.id) now observe it; useAiMessages(conversation.id)
// reads the transcript once a message lands.
```

`inputParts` is a structured content-part array, never a flat string — the
same contract the transcript itself uses, so an image/PDF turn needs no
shape change later. `useAiRun(runId)` fetches the durable run; `useCancelAiRun()`
cancels it. `useAiMessages(conversationId)` is a `useInfiniteQuery` over the
transcript, keyset-paginated by the monotonic `sequence` field (a plain
integer cursor, unlike the notification feed's opaque cursor string) — the
route lives on `ai-conversation-control.controller.ts` even though its path
(`/ai/conversations/:id/messages`) reads like it belongs on the plain
conversations controller.

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
a custom reader:

```ts
useEventSource({
  url: '/api/notifications/stream', // relative + same-origin — never an apps/api URL
  schema: notificationSseEventSchema, // shared Zod schema; an unparseable frame is dropped, not trusted
  onOpen: refetch, // connect the stream, *then* refetch — closes the subscribe-vs-snapshot race
  onEvent: refetch, // content-free hint: "something changed", never the new state itself
})
```

`useNotificationsStream()` and `useAiRunStream(runId)` are both thin
wrappers over this: `onOpen`/`onEvent` both invalidate the relevant
TanStack Query key(s), never write the event payload into the cache
directly — Postgres (fetched over plain HTTP) stays the source of truth,
matching the "content-free hint" design both backend surfaces already
document. `EventSource`'s own automatic reconnect covers the "stream closes
at token expiry, client reconnects" behavior the backend enforces
server-side.

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
- [Testing](./testing.md) — which layer to test a given hook/flow at.
- [Media](../media/README.md), [Notifications](../notifications/README.md),
  [AI](../ai/README.md) — the backend contracts these hooks consume.
