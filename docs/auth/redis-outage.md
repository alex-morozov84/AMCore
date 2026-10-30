# Authentication when Redis is slow or unavailable

Read this page when you operate the API, or call it, and Redis stops answering in time.
It explains which authentication steps depend on Redis, how long a caller waits, what a
refusal does and does not mean, and how the API recovers. It covers the API process. The web
server's session vault is a separate Redis client and is not described here.

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

Admission and OAuth refusals use this body (standard envelope fields omitted):

```json
{ "errorCode": "SERVICE_UNAVAILABLE", "message": "Authentication temporarily unavailable" }
```

Retry later with backoff. Other `503` answers, such as the abuse-counter ones, keep their own
messages.

**What a refusal means.** A refused _admission_ means the controller did not start. It does not
mean Redis was untouched: a command that was already sent may still run after the caller gave up
(a counter write, a lock, a cache fill). Nothing is retried for you.

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

## What to watch

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
- An unexpected programming or schema error stays a `500`; only Redis outage-class failures become
  the `503`.
