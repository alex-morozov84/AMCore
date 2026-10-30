# Authentication when Redis is slow or unavailable

Read this page when you operate the API, or call it, and Redis stops answering in time.
It explains which requests keep working, which are refused, how long a caller waits and
how the API recovers. It covers the API process. The web server's session vault is a
separate Redis client and is not described here.

## What a client sees

A request that needs Redis and cannot get an answer in time is refused. The API never lets
it through "just in case".

| Request                                    | Needs Redis?                      | During an outage                                      |
| ------------------------------------------ | --------------------------------- | ----------------------------------------------------- |
| Personal JWT request (no organization)     | No: user check reads the database | Works                                                 |
| Organization-scoped JWT or API key request | Yes: permissions cache read       | `503` `SERVICE_UNAVAILABLE`; the handler does not run |
| OAuth start, callback and exchange         | Yes: one-time state and ticket    | `503` `SERVICE_UNAVAILABLE`                           |
| API key or invitation failure counters     | Yes: abuse counters               | `503` as before; nothing is counted as allowed        |
| Public routes that never touch Redis       | No                                | Work                                                  |

The refusal is always (standard envelope fields omitted):

```json
{ "errorCode": "SERVICE_UNAVAILABLE", "message": "Authentication temporarily unavailable" }
```

with status `503`. Retry later with backoff. A refused request changed nothing, with one
exception that matters: during OAuth sign-in the account or provider link may already be
saved when the one-time ticket cannot be stored. Start the sign-in again; the same account is
matched. A one-time state or ticket whose answer was lost may already be used up, so the API
never repeats that call for you.

Permissions are not read from the database as a substitute. The database result alone is not an
availability fallback, and a stale cached version is never used.

## How long a caller waits

- Request admission (credential check through the final authorization guards) runs under one
  absolute deadline of 1 s. At expiry the caller gets the `503` and the handler never runs.
  Work still in flight finishes in the background and its result is ignored; it starts no new
  cache call.
- One cache or lock call waits at most 250 ms, or what is left of the admission deadline.
- A process holds at most 256 admission attempts that have not finished, including abandoned
  ones. Beyond that, new attempts are refused at once, before any database work.
- A command that was already sent may still run in Redis after the caller gave up. Nothing is
  retried.

## How the API recovers

The authentication path uses its own Redis client, separate from the shared one. A supervisor
replaces that client when it stops answering:

| Condition                                       | Replaced after                                               |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Oldest unanswered command is older than 2 s     | immediately, but not more often than 1, 2, 4, then 8 s apart |
| Connecting or reconnecting makes no progress    | 3 s                                                          |
| The client closed itself                        | 3 s                                                          |
| No successful command for 3 s on a ready client | as for the first row                                         |
| A heartbeat `PING` does not answer `PONG`       | 3 s                                                          |

Measured on one machine with injected faults (streams held, dropped or refused), not as a
promise: a stall is noticed within about 3.3 s; after the cause clears, requests succeed again
within about 3.5 s, or up to about 8.5 s when the stall repeats within 30 s. While Redis stays
down, requests keep getting the fast `503`. The old client is destroyed at once and counted as
closed when `destroy()` returns; the operating system may close the socket a few
milliseconds later.

## What to watch

- Metric `redis_client_events_total{client="auth"}`: `error`, `reconnecting` and `degraded`
  (one per replacement or alert).
- Log `Auth Redis client generation replaced` with `reason`: `stall`, `no-success`,
  `handshake`, `reconnect-hang`, `unplanned-end` or `protocol-mismatch`.
- Log `Auth Redis alert`: `retire-timeout` (a destroyed client still reports open; restart the
  process if it persists), `retiring-cap` (replacements are refused until old clients close) and
  `protocol-mismatch`.

Repeated replacements about every 3 s mean Redis or the network path is down. Fix that
dependency first. The shared client's health check and its metrics are separate.

## Limits

- No automatic database fallback for Redis errors, and no retry of mutations or one-time steps.
- The shared Redis client and the job, subscriber and health connections are not supervised by
  this mechanism.
- The heartbeat check detects one reproduced misaligned-stream fault. It does not defend against
  arbitrary corruption.
- An unexpected programming or schema error stays a `500`; only Redis outage-class failures become
  the `503`.
