# AI Human Takeover and Operator Review

Human takeover lets a user or privileged support operator pause bot ownership and
write human-authored assistant-seat turns. The ownership generation fence prevents
stale bot runs from writing after takeover.

## Owner Flow

Set `API_BASE` to your API URL including `/api/v1` (for example,
`http://localhost:5002/api/v1` if your API listens on port 5002).
Set `CONV_ID` to the conversation ID and `USER_JWT` to its owner’s token.
Confirm takeover succeeds before posting a human turn.

```bash
curl -fsS -X POST "${API_BASE}/ai/conversations/${CONV_ID}/takeover" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H 'Content-Type: application/json' \
  -d '{}' &&

curl -fsS -X POST "${API_BASE}/ai/conversations/${CONV_ID}/messages" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H 'Content-Type: application/json' \
  -d '{"content":[{"type":"text","text":"I will handle this manually."}]}' &&

curl -fsS -X POST "${API_BASE}/ai/conversations/${CONV_ID}/release" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

If takeover or posting the message fails, the block skips release. Check who
controls the conversation and whether the message appears in the transcript.
Release control separately if you intend to resume AI handling.

The owner can always reclaim/release their own conversation, even from a
cross-user SUPER_ADMIN holder.

## Cross-user SUPER_ADMIN Flow

Set `ADMIN_JWT` to the freshly authenticated operator’s token.

Cross-user support access requires bearer auth, fresh auth, and a bounded reason
or ticket reference. Transcript-read reason is sent in a header so it does not
leak into query-string logs.

```bash
curl -fsS -X POST "${API_BASE}/ai/conversations/${CONV_ID}/takeover" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"SUPPORT-1234"}'

curl -fsS "${API_BASE}/ai/conversations/${CONV_ID}/messages" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
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
  transcript turns after ownership changes. A tool that was already
  running keeps its recorded outcome (or its uncertainty) — takeover stops the
  conversation from progressing, it does not pretend the effect did not happen;
  nothing is applied to the human-owned transcript and the run ends
  `cancelled` / `superseded_by_human`.
- A cancel the owner already recorded on a running run takes precedence over a
  takeover when both are visible.
- Operator messages require the actor to currently hold control.
- Human turns are stored as `role=assistant` with `authorType=user` or
  `authorType=operator`, preserving who wrote the assistant-seat turn.
- A different SUPER_ADMIN cannot take over a conversation already held by another
  human (`409`).
- A run archived after queued cancellation or expiry keeps its original USER
  message. The transcript reports `originRunId` and `originArchived`. An archived
  replay with the same key and input returns `410` even after takeover or closure.
- A linked operator retry adds no USER turn. Child assistant messages report
  `operatorRetryOfRunId`; transcript access stays under this endpoint's owner or
  audited cross-user authorization.
