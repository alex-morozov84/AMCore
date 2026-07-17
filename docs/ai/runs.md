# AI Conversations and Runs

AI conversations are owner-scoped durable transcripts. A run is one user turn
plus the worker execution that produces an assistant turn, parks for approval, or
terminates with a bounded error.

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

## Run Lifecycle

```text
queued → running → completed
              ├→ waiting_approval → queued → running
              ├→ failed
              ├→ cancelled
              └→ expired
```

Key behavior:

- Run creation is idempotent on `(conversationId, idempotencyKey)`.
- The selected model is frozen into the run snapshot at creation time.
- The worker owns provider calls, retries, lease recovery, final transcript write,
  and usage ledger write.
- Cancellation is cooperative: queued runs cancel immediately; running runs record
  a cancel request that the worker observes.
- Provider effects are at-least-once; durable AMCore outcome is exactly-once by
  transaction/CAS.

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

## Configuration

| Env var                                                           | Purpose                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `AI_REQUEST_TIMEOUT_MS`                                           | Provider-call timeout.                                  |
| `AI_REALTIME_NAMESPACE`                                           | Redis channel namespace for run SSE.                    |
| `AI_REALTIME_HEARTBEAT_MS` / `AI_REALTIME_MAX_STREAM_LIFETIME_MS` | SSE keepalive / hard lifetime.                          |
| `AI_REALTIME_MAX_PER_USER` / `AI_REALTIME_MAX_CONNECTIONS`        | Per-user/global SSE caps.                               |
| `AI_REALTIME_QUEUE_DEPTH`                                         | Per-connection write buffer before slow-consumer close. |
