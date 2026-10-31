# Authentication when Redis is slow or unavailable

Read this page when you operate the API, or call it, and Redis stops answering in time.
It explains which authentication steps depend on Redis, how long a caller waits, what a
refusal does and does not mean, and how the API recovers. It covers the API process and, in
[its own section](#the-web-servers-session-vault), the web server's session vault, which uses a
separate Redis connection. When the API and the web server use the same Redis, one outage hits both.

Terms used below:

- **Admission**: the checks before a handler runs (who is calling, may they, which organization).
  A refused admission means the handler never started.
- **Generation**: one Redis connection. A supervisor replaces a stuck one with a new generation.
- **Owner lease**: a short Redis lock that lets one worker at a time run an invitation command.

## What a client sees

An authentication step that needs Redis and cannot get an answer in time is refused. The API
never lets it through "just in case".

| Request                                    | Redis in the authentication step?     | During an outage                                          |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------------------- |
| Personal JWT request (no organization)     | No: the user check reads the database | Admission succeeds; the handler may still use Redis       |
| Organization-scoped JWT or API key request | Yes: permissions cache read           | Admission is refused with `503`; the handler does not run |
| OAuth start, callback and exchange         | Yes: one-time state and ticket        | `503` from inside the operation (see below)               |
| API key or invitation failure counters     | Yes: abuse counters                   | `503` with its own message, as before                     |
| Public routes that never touch Redis       | No                                    | Work                                                      |

Only the personal user check lost its Redis dependency. A handler, the rate limiter and other
protections that use Redis keep their own behavior.

Admission and OAuth refusals use this body. "Exact" below means the same `errorCode` and `message`;
the standard envelope fields around them are omitted here:

```json
{ "errorCode": "SERVICE_UNAVAILABLE", "message": "Authentication temporarily unavailable" }
```

Retry later with backoff. Other `503` answers, such as the abuse-counter ones, keep their own
messages.

**What a refusal means.** A refused _admission_ means the controller did not start. It does not
mean Redis was untouched: a command that was already sent may still run after the caller gave up
(a counter write, a lock, a cache fill). Nothing is retried for you.

**Can a client resend a write?** On a route that is not OAuth, the exact admission body above means
the handler did not run, so resending is safe. Any other `503` message says nothing about whether
the handler ran: send writes with an idempotency key (see
[idempotency](../operations/idempotency.md)) or check the result before resending. Do not reload an
OAuth callback URL; start the sign-in again.

**OAuth is different.** Its Redis steps run inside the operation. The account or provider link
can already be saved when the one-time ticket cannot be stored; start sign-in again and the
same account is matched. A one-time state or ticket whose answer was lost may already be used
up, so the API never repeats that call.

Permissions are not read from the database as a substitute for the cache. A completed database
load is not an availability fallback, and a stale cached version is never used.

## How long a caller waits

- Request admission (credential check through the final authorization guards) runs under one
  absolute deadline of 1 s. At expiry the caller gets the `503` and the handler never runs.
  Work already in flight finishes in the background and its result is ignored. After expiry the
  admission starts no next credential, no further database query, no counter write and no cache
  call. A command that was already sent may still complete.
- One cache, lock or counter call waits at most 250 ms, or what is left of the admission deadline.
- Each Redis phase of an OAuth step (store the state, consume the state, store the ticket,
  consume the ticket) has its own 1.5 s deadline. The provider HTTP exchange and the account
  commit are not bounded by it.
- A process holds at most 256 admission attempts that have not finished, including abandoned
  ones. Beyond that, new attempts are refused at once, before any database work.
- Password reset and email verification have no Redis phase after the user cache was removed, so
  they have no such deadline.

## How the API recovers

The authentication path uses its own Redis client, separate from the shared one. A supervisor
replaces that client when it stops answering. It checks every 250 ms:

| Condition                                              | Replacement happens                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Oldest unanswered command is older than 2 s            | at the next check, at least 1, then 2, 4 and 8 s after the previous stall replacement |
| No successful command for 3 s on a ready client        | at the next check, under the same cooldown as above                                   |
| Connecting or reconnecting makes no progress for 3 s   | at the next check; progress means a new connection event, not a timer                 |
| The client closed itself                               | at the next check at least 3 s after the previous replacement                         |
| A heartbeat `PING` answers something other than `PONG` | at the next heartbeat at least 3 s after the previous replacement                     |

A heartbeat that times out or fails is an ordinary failed command and falls under the first rows.

**Recovery times.** Treat them as targets for these fault classes, with an available replacement
connection and capacity, not as guarantees:

- Target: a stall is noticed within about 3.3 s; after the cause clears, requests succeed again
  within about 3.5 s, or up to about 8.5 s when stalls repeat within 30 s.
- Observed in the probe prototype (injected faults, one machine): recovery from 0.1 to 2.95 s, and
  4.17 s for the repeated-stall case.
- Asserted by the production tests: the supervisor serves again within 4.5 s of a stall clearing,
  and the whole API serves an organization request again within 12 s of Redis resuming.
- No recovery promise applies while Redis stays down or when retirement capacity is exhausted;
  requests keep getting the fast `503`.

**Disposal.** A replaced client is counted as closed when node-redis reports it closed
(`isOpen` is false after `destroy()`). Otherwise it stays counted as leaked and raises an alert.
The operating system may close the socket later; this is not promised or waited for.

## The web server's session vault

The Next.js server keeps each browser session's backend tokens in a Redis vault (ADR-068) and
refreshes them when a request needs a fresh access token. Three things moved to a supervised
connection of their own, replaced by the same triggers as the API's authentication client: the
session vault store, the session lock factory and the refresh. The lock factory is also used by the
invitation owner lease, so that lease runs on the supervised connection too: a held lease still
answers "busy", an unreachable connection is a temporary failure, and acquisition waits at most 3 s.
Every other web-server Redis record store (invitation, MFA and OAuth attempt records, Console return
entries) stays on the shared connection. The 3 s admission budget does not cover them. In the
real-stack check an invitation link opened during an 8 s stall answered after about 8.4 s and then
opened the flow normally, with no membership created. The owner lease's own 3 s limit does not
change that: it caps only the lease step, not the page. The check looked at the membership only,
so other records the flow creates were not examined. A product-administration OAuth sign-in started
during the same stall also waited and then signed in. When the stall begins after a healthy start,
at the moment the provider returns the browser, the callback goes straight to the API: the one-time
state step is refused fast, the browser lands on the sign-in page with a provider error, no backend
session is created, and starting the sign-in again after recovery works. Other pages that use these
stores were not measured.

**What a request sees.** Session admission has one absolute budget of 3 s: vault read, the
browser-binding check and, when a refresh is needed, waiting for the refresh. Nothing starts once the
budget is spent and a step that finishes late is not accepted. The binding check waits at most the
smaller of what is left and 10 s. A shorter wait refuses the request; it never skips the check. A
Route Handler or API-proxy request that runs out of time or cannot reach the vault answers `503`
with `errorCode` `SERVICE_UNAVAILABLE`; the session is not ended and the cookie stays. The response
carries a `Retry-After` header only when the backend relayed one (for example a rate-limited binding
check). A Server Component page does not get that JSON: the data layer returns "not signed in" only
for an explicit invalid or lost-exclusivity outcome and otherwise lets the page's error boundary
show the temporary failure. The HTTP status of a streamed page is not described here.

**One refresh owner.** In each web-server process one owner refreshes a session, whatever the number
of waiting requests. A request may leave at its 3 s limit while the owner continues under its own
budget: lock wait up to 3 s, each vault command up to 1 s, a 10 s lease renewed every 4 s, and a 30 s
ceiling for the work before the new tokens are published. At the ceiling ordinary work ends; a lease
that is still held keeps being renewed while a bounded delete and the lock release run. A lease that
was refused or lost is not renewed further. Several processes contend for one Redis lock; a process
that cannot get it in 3 s answers the `503`.

Stored record and response are two separate outcomes. "Kept" below says the vault entry was left
alone; it does not mean the request got a temporary error.

| Situation                                                                                                              | Stored session                                                                   | Route Handler / API proxy                          | Page (data layer)                                   |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Vault unreachable, admission budget spent, or the lock not obtained in 3 s                                             | Kept                                                                             | `503` `SERVICE_UNAVAILABLE`                        | Error boundary                                      |
| The backend call fails without an answer (network, timeout)                                                            | Kept                                                                             | `503`                                              | Error boundary                                      |
| Lease lost or the ceiling reached before the backend call was sent                                                     | Kept (nothing was rotated)                                                       | `401`, the same answer as any lost exclusivity     | Treated as signed out; the next request can succeed |
| The backend refuses the refresh token (invalid or reused)                                                              | A bounded delete is attempted; if it fails the stored state is unknown           | `401`                                              | Treated as signed out                               |
| Lease lost or the ceiling reached after the call was sent                                                              | Rotation cannot be ruled out: the attempt ends and a bounded delete is attempted | `401`                                              | Treated as signed out                               |
| The backend answered success but its body is unreadable or has no access token, or publication cannot be proven        | Same: bounded delete attempted                                                   | `503`                                              | Error boundary                                      |
| The backend answered success but the reply carries no rotated refresh cookie                                           | Same as an explicit refusal: a bounded delete is attempted                       | `401`                                              | Treated as signed out                               |
| The check of the rotated credentials refuses (`503`, `429`, `401` `AUTH_CONTEXT_CHANGED`)                              | Bounded delete attempted unless the new tokens are already published             | The check's own status and code                    | Follows that status                                 |
| The vault already shows the new tokens (this owner's write, or a newer entry), then the check refuses or time runs out | Not deleted                                                                      | The check's own status, or `503` when time ran out | Follows that status                                 |

A failed delete leaves the stored state unknown, so a terminal result does not prove the session was
deleted. A later request may continue from a fresh publication, find no session and ask for sign-in,
or be rejected by the backend. A dependency failure of the binding check is not relabeled as a
changed context. During publication only a classified Redis outage is read back and retried; any
other error is kept with its cause for diagnosis. In the API an unexpected programming or schema
error stays a `500`; the web edge answers its generic sanitized `503` for failures it cannot
classify, which is a statement about the response, not a claim that the cause was an outage.

**Operations Console during a vault outage.** A Console route cannot confirm that the visitor is a
`SUPER_ADMIN` while the vault is unavailable, so it shows the temporary "unavailable" page and
nothing else: no navigation, no data and no operator identity. The page is not a `404`, so it
discloses one fact. A request that carries any non-empty value in the session cookie, even an invented
one, can see the temporary page and learn that the Console route exists. A request without a cookie
still gets the plain `404`. After recovery the ordinary denial returns for absent, invented and
non-operator sessions, and an authorized `SUPER_ADMIN` gets the Console again. This was verified for
the path-mode Console. In host mode the Console host gave the same temporary refusal to copied
product and staff cookies and to an invented cookie, and still answered a request without a cookie
as it does in a healthy system.

**What to watch in the web server.** It logs `Vault Redis client generation replaced` with the reason,
`Vault Redis alert` (with the same alert names as the API list below; lines that start with `Vault Redis` come from the web server, lines that start with `Auth Redis` from the API) and `Vault Redis client error`. It exports no metric for this connection and
installs no shutdown hook for it. The heartbeat check is a diagnostic, not a defense against
arbitrary stream corruption.

## What to watch in the API

- Metric `redis_client_events_total{client="auth"}`: `error`, `reconnecting` and `degraded`
  (one per replacement or alert).
- Log `Auth Redis client generation replaced` with `reason`: `stall`, `no-success`,
  `handshake`, `reconnect-hang`, `unplanned-end` or `protocol-mismatch`.
- Log `Auth Redis alert`: `retire-timeout` (a destroyed client still reports open; restart the
  process if it persists), `retiring-cap` (replacements are refused until old clients close) and
  `protocol-mismatch`. At shutdown, `Auth Redis shutdown left generations logically open` means a
  client did not close; the process is ending, so only note it.

Repeated replacements about every 3 s mean Redis or the network path is down. Fix that
dependency first. The shared client's health check and its metrics are separate.

## Limits

- No automatic database fallback for Redis errors, and no retry of mutations or one-time steps.
- The shared Redis client and the job, subscriber and health connections are not supervised by
  this mechanism.
- The heartbeat check detects one reproduced misaligned-stream fault. It is a diagnostic, not a
  security check and not a defense against arbitrary corruption.
- In the API an unexpected programming or schema error stays a `500`; only Redis outage-class
  failures become the `503`. The web edge answers its generic sanitized `503` for failures it
  cannot classify (see the web section above).
