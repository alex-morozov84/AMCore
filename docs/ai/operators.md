# AI Human Takeover and Operator Review

Human takeover lets a user or privileged support operator pause bot ownership and
write human-authored assistant-seat turns. The ownership generation fence prevents
stale bot runs from writing after takeover.

## Owner Flow

```bash
curl -X POST /ai/conversations/<conversation-id>/takeover \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{}'

curl -X POST /ai/conversations/<conversation-id>/messages \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"content":[{"type":"text","text":"I will handle this manually."}]}'

curl -X POST /ai/conversations/<conversation-id>/release \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

The owner can always reclaim/release their own conversation, even from a
cross-user SUPER_ADMIN holder.

## Cross-user SUPER_ADMIN Flow

Cross-user support access requires bearer auth, fresh auth, and a bounded reason
or ticket reference. Transcript-read reason is sent in a header so it does not
leak into query-string logs.

```bash
curl -X POST /ai/conversations/<conversation-id>/takeover \
  -H 'Authorization: Bearer <fresh-admin-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"SUPPORT-1234"}'

curl /ai/conversations/<conversation-id>/messages \
  -H 'Authorization: Bearer <fresh-admin-jwt>' \
  -H 'x-amcore-operator-reason: SUPPORT-1234'
```

Cross-user transcript and artifact reads are fail-closed audited before content
is served. Owner reads/downloads are not audited as privileged access.

The takeover / release / transcript / operator-message endpoint shapes are in the
OpenAPI document at `/docs`. All are bearer-only (**API keys are rejected**), and
missing or not-visible conversations return no-leak `404`.

## Semantics

- Taking control supersedes unleased queued/waiting bot runs and voids pending
  approvals in the same transaction.
- Leased running runs are left to the worker fence; they cannot commit stale
  transcript/progress rows after ownership changes.
- Operator messages require the actor to currently hold control.
- Human turns are stored as `role=assistant` with `authorType=user` or
  `authorType=operator`, preserving who wrote the assistant-seat turn.
- A different SUPER_ADMIN cannot take over a conversation already held by another
  human (`409`).
