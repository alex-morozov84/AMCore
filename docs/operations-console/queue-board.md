# Queue board

[Operations Console](README.md) → [Background work](background-work.md) → Queue board

The queue board is a view into the background queues' jobs. [Background work](background-work.md)
tells you that, say, `email` has 12 failed jobs; the board lets you see which jobs, when they
ran, how many attempts they used and whether they failed. It is **view-only**: it cannot retry,
promote, clean, pause, resume or delete anything, and no setting adds that ability.

It is the [Bull Board](https://github.com/felixmosh/bull-board) UI that ships with the API,
opened through your Console session, with a closed list of what it may show and do.

## Open it

On **Background work**, use **Open queue board** (it opens in a new tab), or the link on a
queue's row. You do not sign in again: the Console passes your session to the board, and the
browser never receives an API token.

| Setup                         | Address of the board                            |
| ----------------------------- | ----------------------------------------------- |
| Path mode                     | `https://<product-host>/api/console/bull-board` |
| Host mode                     | `https://<console-host>/api/bull-board`         |
| Direct to the API (see below) | `https://<api-host>/api/v1/admin/queues/`       |

The addresses have no trailing slash; the web server redirects one that has it.
A queue's page is `…/queue/<name>`, for example `…/queue/email`; a job's is
`…/queue/<name>/<job-id>`. You can bookmark them. A page always carries a **READ-ONLY** mark in
its header, including when you open it from a bookmark.

The address is not configurable. The board draws itself under that path, so changing it means
changing three things together: the public-path function in
`apps/web/src/shared/lib/console-public-href.ts`, the route
`apps/web/src/app/api/console/bull-board/`, and your proxy rules (the reference nginx and Caddy
configurations already forward `/api/*` to the Console in host mode and need no new rule).
`ENABLE_BULL_BOARD` below is the only setting.

## Who can open it

Only a current platform `SUPER_ADMIN`. An organization role does not grant access, and API keys
are rejected. The check runs on **every** request the page makes (page, assets and data), against
the database, not a cache.

| What happens                                          | When the board stops answering                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You sign out of the Console                           | At once for new requests. A tab that is already open keeps what it shows and its next refresh is refused.                                                   |
| Your sessions are revoked from somewhere else         | When the access token the Console holds expires (15 minutes by default, `JWT_ACCESS_EXPIRATION`): the Console cannot renew it. Not instant.                 |
| Your access token expires while your session is valid | Never visibly: the Console renews it.                                                                                                                       |
| You are demoted from `SUPER_ADMIN`                    | On the next request.                                                                                                                                        |
| You are promoted to `SUPER_ADMIN`                     | After your next sign-in, or when the Console renews your access token (within 15 minutes): a token issued earlier still says you were not an administrator. |
| Your account is deleted                               | On the next request.                                                                                                                                        |

Data already shown is not taken back. A page without access gets a plain not-found response, as
the rest of the Console does.

## Enabling the board

<a id="enabling-the-board"></a>

In **production the board is off** until you turn it on. Set `ENABLE_BULL_BOARD=true` in the
environment of the **API process** (Docker, Kubernetes, systemd or your shell) and restart the
API. The file `.env` does **not** work for this: the decision is taken when the API starts,
before `.env` is read. Outside production the board is always on.

Turning it on does not change what the board allows: it stays view-only. The `worker` process
never serves it; run the API as `web` or `all`.

When the board is off, Background work says so and shows these steps, with a link to this
guide. That message appears only when the API confirmed that this is the cause. If the board
cannot be opened for any other reason, Background work says that it could not be opened and does
not suggest a setting.

### `BULL_BOARD_READ_ONLY` has been removed

Earlier versions let `BULL_BOARD_READ_ONLY=false` turn on retry, promote, clean and remove. That
option is gone, and so is the ability. The variable is **ignored whatever its value**; the API
logs one warning at start while it is still set (the warning event is
`bull_board.legacy_read_only_flag_ignored`). Delete it from your environment.

Use the native [Background work controls](background-work.md) for supported actions. They require
confirmation and record administrative intent and receipts; the board remains a separate view.

## What the board shows

The board shows what an operator needs to find a stuck or failing job and hides what could carry
a secret. The rule is a closed list, applied on the server: a field that is not on the list is
not sent.

| Shown                                                                                        | Not shown                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Queues, their state and counts, job lists and pages                                          | Job payloads and return values: the board shows `[hidden]`                                                         |
| For a job: id, name, times, attempts, delay, whether it failed                               | The failure message and stack trace: the board says that failure details are not displayed                         |
| Job options for retries and retention (attempts, backoff, delay, priority, retention)        | Job logs: the board says that logs are not displayed                                                               |
| For a **welcome email** job: template, locale and the user id                                | Recipient address and name. Workers, Redis details, metrics, schedulers, flows and default job options are hidden. |
| For a **notification** wake job: the notification id; for an **AI run** wake job: the run id |                                                                                                                    |

Payloads of the `default` queue and of any queue you add are hidden entirely, because the
starter cannot know what they contain. This is a closed list for a trusted operator, **not a
promise that no secret can exist** in a queue. The rule that matters is the one for producers:
a secret (a reset or verification link, a token) must never be put in a queue; the starter sends
those emails directly. See [Email security](../email/security.md).

Every enabled registered queue is on the board, the same rule that gives it a row in Background work:
add its [work registration](../backend/background-work.md) and it appears in both. Its jobs show only identifiers, names and times
until a projection names the fields to show. For an **AI run** wake job that is the run id. A wake
queue only nudges a worker, and the state of the run lives in the database, so `ai-runs` is usually
empty here.

Numeric progress is shown only within 0–100. Object progress and hidden concurrency are labelled
**Not displayed** (localized), rather than reported as zero or unset. Rate-limit, scheduler and flow
controls are hidden; the board does not assert that those features are absent from Redis.
Queue info does not fetch default job options for read-only queues. That API channel remains
closed. The installed UI assets used for this behavior and flow concealment are checked by
size, SHA256 and exact structural seams before the board mounts; a Bull Board upgrade must
update those checks and pass the rendered-disclosure tests.

Lists observe the first **512 IDs per state**, at most **50 jobs per page**, with a **512KiB**
aggregate job-read budget. Counts describe the full queue, while pagination stops at this bounded
window. A job observation permits at most 64 hash fields and 64KiB, with smaller field-specific
limits. Detail membership checks refuse collections above 4096 entries. Unsupported content,
layout or a read limit fails closed; use native diagnostics and operator recovery instead of
assuming an empty queue. These observation limits never restrict native queue pause/resume.

### Showing the payload of your own queue

Add an entry for its name to the `BOARD_DATA_PROJECTIONS` map in
`apps/api/src/infrastructure/queue/dashboard/bull-board-data-projections.ts`. A projection
receives the raw payload and returns a small object rebuilt only from fields it validated (type,
length and format), or `null` to hide it. Return identifiers and categories, never addresses,
names, tokens or free text, and add tests like those beside the shipped ones.

## When something is not as expected

| You see                                                       | Meaning and what to do                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Queue board is not enabled" on Background work               | Production without `ENABLE_BULL_BOARD=true` in the API process environment. Follow [Enabling the board](#enabling-the-board).                        |
| "Could not open the queue board"                              | The API did not answer correctly (not reachable, error or timeout). Check that the API is up and try again. The message is not about a setting.      |
| A plain "not found" when you open the board                   | You are not signed in to the Console, are not a `SUPER_ADMIN`, or the Console is not served on this host.                                            |
| No **Open queue board** button, no row links                  | The board is off, or access is being re-verified.                                                                                                    |
| A message in the browser console about `fonts.googleapis.com` | Expected. The board's page asks for a web font from Google; the board's policy blocks it and the board uses system fonts. No request reaches Google. |

## Notes for operators

- The board refreshes every 15 seconds and the page's data is not cached by the browser or a
  proxy. A proxy in front of the API must not cache `…/admin/queues` responses.
- Access logs of your edge contain queue names and job ids from the board's addresses
  (never payloads). Treat them as operational data.
- Everything the board answers carries its own security policy: only its own scripts, no
  framing, no referrer. This is separate from the Console's policy.
- For a data or asset request that fails, the Console builds its own JSON error with a fixed
  message and the path you requested; it never forwards the API's error body. These errors carry
  the board's security policy and `Cache-Control: private, no-store`, including on `HEAD`.
- Board counts, lists and details use bounded, read-only Redis scripts. They do not remove legacy
  markers or load entire job hashes through BullMQ's standard readers.
- The board is a snapshot of Redis state. Its numbers can differ slightly from Background work
  taken at another moment.
- With the Console switched off (`pnpm init:project --admin-console=disabled`) the API keeps the
  board. Open it directly at `/api/v1/admin/queues/` in a browser that holds the API's own session
  cookie, as a signed-in `SUPER_ADMIN`; it is the same view-only board, without the Console's
  entry points.

## Related

- [Background work](background-work.md): counts and states of every queue, without job details.
- [Configuration and deployment](configuration.md): topology, edge and session settings.
- [Email security](../email/security.md): what is allowed in a queue.
