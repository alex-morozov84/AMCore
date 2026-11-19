# AI Multimodal Artifacts

Artifacts are private uploaded inputs for AI runs. AMCore supports images
(JPEG/PNG/WebP) and PDFs. Uploads are stored through AMCore storage and referenced
from run input by id; bytes never ride inside JSON content parts.

## Upload and Use an Artifact

Set `API_BASE` to your API URL including `/api/v1` (for example,
`http://localhost:5002/api/v1` if your API listens on port 5002).
Set `CONV_ID` to your conversation ID and `USER_JWT` to its owner’s token.
Use a synthetic local `invoice.pdf`. Confirm the upload returns an artifact ID
before creating the run.

```bash
ARTIFACT_ID=$(
  set -o pipefail
  curl -fsS -X POST "${API_BASE}/ai/conversations/${CONV_ID}/artifacts" \
    -H "Authorization: Bearer ${USER_JWT}" \
    -F 'file=@./invoice.pdf;type=application/pdf' | jq -er '.id | strings | select(length > 0)'
) &&

curl -fsS -X POST "${API_BASE}/ai/runs" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "conversationId": "${CONV_ID}",
  "inputParts": [
    { "type": "text", "text": "Summarize this PDF." },
    { "type": "artifact_ref", "artifactId": "$ARTIFACT_ID" }
  ],
  "idempotencyKey": "pdf-summary-001"
}
JSON
```

If the upload fails or returns no ID, the block skips run creation. If the
upload outcome is unclear, it may already have stored the file. Resolve that
outcome before deciding whether to upload again.

Repeat the same `idempotencyKey` and ordered `inputParts` after a lost
response. If the conversation still admits AI runs, the API returns the
existing run without binding the artifact again. After human takeover or
closure, replay of a run that still exists returns an admission conflict
(`409`). A matching archived request returns `410 AI_RUN_ARCHIVED`.
See [Idempotent creation](runs.md#idempotent-creation) for conflict handling.

An artifact-only run input is valid:

```json
[{ "type": "artifact_ref", "artifactId": "..." }]
```

Human/operator turns posted through `POST /ai/conversations/:id/messages` are
text-only; artifacts are a run-input surface.

## Upload and Download Rules

Upload is an owner-only throttled multipart `POST` to a conversation; download is
an authorized app-mediated `GET` (shapes in the OpenAPI document at `/docs`). The
rules that matter:

- Accepted formats: JPEG, PNG, WebP, PDF.
- GIF, SVG, generic files, OCR, AV scanning, and content/DLP scanning are not shipped.
- Validation uses magic bytes, never the client `Content-Type` alone.
- Uploads are private. The artifact response never returns a public or signed URL.
- Downloads are attachment + `nosniff`; Range requests are not supported.
- Cross-user SUPER_ADMIN downloads require fresh auth + bounded reason and are
  fail-closed audited before bytes are served.

## Capability Gates

At run creation, every `artifact_ref` is validated in the run transaction:

- artifact belongs to the conversation;
- image requires model `vision`;
- PDF requires model `pdf`;
- bound assistant `allowedModalities` includes the artifact modality;
- per-message artifact count and aggregate raw-byte budget are within limits;
- rebind matrix allows the artifact to bind to this run.

The worker repeats capability checks from the frozen model snapshot before bytes
reach the provider. The gateway is the final central capability backstop.

## Reuse / Rebind Matrix

An artifact binds to one run. It may be rebound only after its previous run is
terminal and not completed:

| Previous bound run status                                   | Rebind?    |
| ----------------------------------------------------------- | ---------- |
| `failed`                                                    | yes        |
| `cancelled`                                                 | yes        |
| `expired`                                                   | yes        |
| `queued` / `running` / `waiting_approval` / `waiting_human` | no (`409`) |
| `completed`                                                 | no (`409`) |

This avoids stale writes and takeover bypass while allowing retry after failures
where the uploaded bytes were not the problem.

Operator manual retry is a separate, narrower action. It refuses every run whose
original input contains `artifact_ref`, even when its uploaded bytes still exist.
The command never downloads, copies or rebinds an artifact. A user may start a
new run through the ordinary API, subject to the binding rules above.

## Provider Representation

The worker downloads bytes server-side and maps them to provider SDK image/file
parts. AMCore never hands a storage URL to the provider. Multimodal parts are
sibling parts in the same untrusted user turn as text; they never enter `system`.

## Configuration

| Env var                             | Purpose                                 |
| ----------------------------------- | --------------------------------------- |
| `AI_ARTIFACT_MAX_IMAGE_BYTES`       | Max raw upload bytes for an image.      |
| `AI_ARTIFACT_MAX_DOCUMENT_BYTES`    | Max raw upload bytes for a PDF.         |
| `AI_ARTIFACT_MAX_PARTS_PER_MESSAGE` | Max `artifact_ref` parts per run input. |
