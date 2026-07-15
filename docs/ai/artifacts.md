# AI Multimodal Artifacts

Artifacts are private uploaded inputs for AI runs. Arc G supports images
(JPEG/PNG/WebP) and PDFs. Uploads are stored through AMCore storage and referenced
from run input by id; bytes never ride inside JSON content parts.

## Upload and Use an Artifact

```bash
ARTIFACT_ID=$(
  curl -s -X POST /ai/conversations/<conversation-id>/artifacts \
    -H 'Authorization: Bearer <owner-jwt>' \
    -F 'file=@./invoice.pdf;type=application/pdf' | jq -r '.id'
)

curl -X POST /ai/runs \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "conversationId": "<conversation-id>",
  "inputParts": [
    { "type": "text", "text": "Summarize this PDF." },
    { "type": "artifact_ref", "artifactId": "$ARTIFACT_ID" }
  ],
  "idempotencyKey": "pdf-summary-001"
}
JSON
```

An artifact-only run input is valid:

```json
[{ "type": "artifact_ref", "artifactId": "..." }]
```

Human/operator turns posted through `POST /ai/conversations/:id/messages` are
text-only; artifacts are a run-input surface.

## Upload and Download Rules

| Method + path                                     | Purpose                                 |
| ------------------------------------------------- | --------------------------------------- |
| `POST /ai/conversations/:id/artifacts`            | Owner-only, throttled multipart upload. |
| `GET /ai/conversations/:id/artifacts/:artifactId` | Authorized app-mediated download.       |

Rules:

- Accepted formats: JPEG, PNG, WebP, PDF.
- GIF, SVG, generic files, OCR, AV scanning, and content/DLP scanning are not shipped.
- Validation uses magic bytes, never the client `Content-Type` alone.
- Uploads are private. The artifact response never returns a public or signed URL.
- Downloads are attachment + `nosniff`, no Range support in Arc G.
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
