# AI Conversations and Runs

AI conversations are owner-scoped durable transcripts. A run is one user turn
plus the worker execution that produces an assistant turn, parks for approval, or
terminates with a bounded reason. Postgres owns every run's state; a worker holds
a run only through a short lease and can lose it at any time without corrupting
anything.

## Create a Conversation and Run

```bash
CONV_ID=$(
  curl -s -X POST /ai/conversations \
    -H 'Authorization: Bearer <user-jwt>' \
    -H 'Content-Type: application/json' \
    -d '{"title":"Support question"}' | jq -r '.id'
)

RUN_ID=$(
  curl -s -X POST /ai/runs \
    -H 'Authorization: Bearer <user-jwt>' \
    -H 'Content-Type: application/json' \
    --data-binary @- <<JSON | jq -r '.id'
{
  "conversationId": "$CONV_ID",
  "inputParts": [{ "type": "text", "text": "Summarize my options." }],
  "idempotencyKey": "demo-001"
}
JSON
)
```

Fetch status and transcript:

```bash
curl /ai/runs/$RUN_ID -H 'Authorization: Bearer <user-jwt>'
curl /ai/conversations/$CONV_ID/messages -H 'Authorization: Bearer <user-jwt>'
```

`inputParts` is always a structured array. Text uses:

```json
[{ "type": "text", "text": "Hello" }]
```

Multimodal input uses `artifact_ref`; see [Artifacts](./artifacts.md).

## Idempotent Creation

Send an `idempotencyKey` (up to the schema limit) when a client may retry a
create — a lost response, a double click, a queue redelivery. The key is scoped
to the conversation.

| Request                              | Result                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| New key                              | A new run is queued.                                                     |
| Same key, **same** `inputParts`      | The original run is returned. Nothing is created, bound or woken.        |
| Same key, **different** `inputParts` | `409 AI_RUN_IDEMPOTENCY_CONFLICT`. Use a new key or repeat the original. |

"Same input" means the same ordered `inputParts`, artifact ids included
(object key order is irrelevant; part order is not). The comparison never
depends on the model, the assistant or the artifact bindings as they look today,
so a replay after a configuration change still returns the original run.

## Run Lifecycle

```text
queued → running → completed
   ↑        ├→ waiting_approval → queued → running …
   │        ├→ queued           (a retry, with backoff)
   │        ├→ failed
   │        ├→ cancelled
   │        └→ expired
   └────────┘
```

Terminal states are `completed`, `failed`, `cancelled` and `expired`. A stopped or
failed run carries a bounded `terminalReasonCode`; a completed run has no terminal
reason. Failures also carry an `errorCode`. Neither code contains prompt text,
provider output or tool data.

Key behavior:

- The selected model is frozen into the run snapshot at creation time.
- The worker owns provider calls, retries, lease recovery, the final transcript
  write and the usage ledger write.
- A run executes in one or more **attempts** (see below). A parked run that is
  approved resumes in a new attempt.
- Provider calls may repeat after a crash. An interrupted read-only tool may also
  repeat; a side-effecting tool stops on uncertainty. Run transitions and tool
  result application are atomic, and one requested tool action has one durable
  identity (see [Tools and approvals](./tools-and-approvals.md)).

## Cancellation

`POST /ai/runs/:id/cancel` is cooperative and is decided under the run's lock,
so a cancel is never lost to an approval, a park or a worker claim racing it.

| Run is…            | Effect                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `queued`           | Cancelled immediately. An approved tool that never started is skipped and never runs.                       |
| `waiting_approval` | Cancelled immediately; the pending approval is voided and audited.                                          |
| `running`          | The request is recorded (`cancellationRequested: true`); the status stays `running` until the worker stops. |
| terminal           | No-op; the response reports the final status.                                                               |

A recorded request is **not** a terminal state. The worker checks before every
provider call and every tool start, so after a cancel it starts no further model
call and no further tool. It does **not** abort a provider call or tool that is
already in flight: the call finishes (or hits its timeout), its usage and any
tool outcome are still recorded, and the run then ends `cancelled` with no
assistant message. The worst-case delay is the remaining provider or tool
timeout (`AI_REQUEST_TIMEOUT_MS`, `AI_TOOL_EXECUTION_TIMEOUT_MS`).

If several stop causes are visible at once, the first of these wins:
`cancelled_by_user`, `superseded_by_human`, `deadline_exceeded`.

## Run Lifetime (Deadline)

Every run gets a server-side, immutable lifetime: `deadlineAt = createdAt +
AI_RUN_DEADLINE_MS`, computed in the database from the run's own `createdAt`
(application clock skew cannot shift it) (default **48 hours**, range 1 minute – 30 days). The clock
includes queue time, retry backoff and human approval waits; per-call provider
and tool timeouts are separate and shorter. A run past its lifetime ends
`expired` / `deadline_exceeded`; an in-flight provider call is aborted when the
lifetime ends. An approval cannot outlive the run: its expiry is the sooner of
`AI_APPROVAL_TTL_MS` and the remaining lifetime. Runs created before this setting
existed have no deadline.

## Attempts, Retries and Leases

A claim gives the worker a **lease** (10 minutes, renewed by every guarded
write). Each claim also starts a new numbered **attempt** — the run's lease
epoch. Attempts and retries are different things:

- The **retry budget** counts consumed retries only (`maxAttempts` executions per
  run; the default is three). A transient provider failure or a lost lease after
  work may have started consumes one retry. A claim, an approval resume, or a
  lease lost before any provider/tool call started consumes none.
- The **attempt history** is a durable, bounded record: one row per attempt with
  its start, whether any I/O was admitted ("possible start" — not proof a call
  left the process), its end, a bounded outcome (`succeeded`, `retry_scheduled`,
  `failed`, `cancelled`, `expired`, `superseded`, `awaiting_approval`,
  `lease_lost`, `reaped`, `effect_unknown`) and a bounded error code. It never
  contains content. At most 128 attempts are recorded per run: a run that
  reaches the cap is failed `attempts_exhausted` / `attempt_history_exhausted`
  rather than losing history.

## Ownership: Only the Current Worker Writes

Every durable write by the executor of a leased run happens inside one guarded
transaction that:

1. locks the conversation, then the run;
2. verifies the lease (token and epoch) **with the database's current time** and
   refuses an expired lease — a lease is never revived;
3. looks at every stop cause (cancel, human takeover, deadline) together.

A worker that stalled, lost its lease and was replaced therefore writes nothing:
no step, usage row, transcript turn, tool record or terminal state. A cancel,
takeover or deadline seen **while** a provider call or tool was running never
erases what already happened: the call's usage and the tool's outcome are
recorded, no assistant message is written, and the run ends as the stop cause.

Lock order is the same everywhere — conversation, then run, then approval, then
tool records — so approve, cancel, approval expiry, takeover (waiting and queued
runs alike) and the lease reaper cannot deadlock.

## Worker Capacity and Shutdown

Each worker process runs at most **two** AI runs at a time, shared by the queue
wake-up and the recovery poller. This is a per-process limit, not a fleet quota
or a rate limit. A lane claims one run at a time, so a lease starts when work
starts, and a slot is held until the physical provider or tool call has settled
— a call that outlives its timeout keeps its slot.

On shutdown the worker stops starting work, waits up to 15 seconds for in-flight
runs, then seals: late results are discarded without writing and the run is
recovered after its lease expires. After the seal no further database or cache
operation of that run's attempt starts — including the reads inside recovery,
transcript reconstruction and the model-catalog lookup (its Redis read and database
fallback) — and the provider request is not started. Operations already in flight
are allowed to settle; their late results are discarded. See
[Deployment](../operations/deployment.md).

## Status-only SSE

`GET /ai/runs/:id/stream` emits content-free status hints:

```json
{ "eventId": "...", "runId": "...", "status": "completed", "reason": "status_changed" }
```

This is not token streaming. Treat the event as “refetch `GET /ai/runs/:id`”.
Postgres remains the source of truth.

Conversation and run endpoint shapes (`/ai/conversations`, `/ai/runs`, the
keyset-paginated list, cancel, and the SSE stream) are in the OpenAPI document at
`/docs`. All are bearer-authenticated and owner-scoped; missing or not-owned
resources return no-leak `404`.

## Terminal Reasons

`terminalReasonCode` is one of a fixed set. The most useful for clients:

| Code                                                                                                           | Meaning                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cancelled_by_user`                                                                                            | The owner cancelled.                                                                                                           |
| `superseded_by_human`                                                                                          | A human took over the conversation; the bot run was abandoned.                                                                 |
| `deadline_exceeded`                                                                                            | The run lifetime ended.                                                                                                        |
| `attempts_exhausted`                                                                                           | The retry budget (or the attempt history cap) was used up.                                                                     |
| `permanent_failure`                                                                                            | A non-retryable provider or input failure; see `errorCode`.                                                                    |
| `guardrail_input_blocked` / `_input_too_large` / `_output_blocked`                                             | A guardrail refused the turn; a fixed refusal message is written.                                                              |
| `tool_loop_exhausted`, `too_many_tool_calls`, `tool_not_allowed`, `tool_args_invalid`, `tool_execution_failed` | The bounded tool loop stopped on policy or a known tool failure.                                                               |
| `approval_expired`                                                                                             | The approval TTL elapsed.                                                                                                      |
| `tool_effect_unknown`                                                                                          | A side-effecting tool may or may not have taken effect; the run stopped without repeating it.                                  |
| `tool_state_inconsistent`, `action_input_conflict`, `tool_schema_incompatible`                                 | A tool action could not be continued safely. Inspect its recorded outcome; an earlier execution may already have taken effect. |
| `assistant_disabled`                                                                                           | The bound assistant was disabled before the run started.                                                                       |

## Configuration

| Env var                                                           | Purpose                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `AI_RUN_DEADLINE_MS`                                              | Immutable lifetime of a run from creation (default 48 h).       |
| `AI_REQUEST_TIMEOUT_MS`                                           | Provider-call timeout.                                          |
| `AI_APPROVAL_TTL_MS`                                              | How long a run may wait for approval (see Tools and approvals). |
| `AI_REALTIME_NAMESPACE`                                           | Redis channel namespace for run SSE.                            |
| `AI_REALTIME_HEARTBEAT_MS` / `AI_REALTIME_MAX_STREAM_LIFETIME_MS` | SSE keepalive / hard lifetime.                                  |
| `AI_REALTIME_MAX_PER_USER` / `AI_REALTIME_MAX_CONNECTIONS`        | Per-user/global SSE caps.                                       |
| `AI_REALTIME_QUEUE_DEPTH`                                         | Per-connection write buffer before slow-consumer close.         |

The lease length, worker capacity, retry backoff and attempt-history cap are
starter defaults tuned by code, not environment variables.
