# AI Assistants

Assistants are AMCore's runtime “agents”. An assistant version defines trusted
instruction text, model selection, allowed input modalities, tool allowlist, and
an optional budget class. A conversation binds one enabled assistant version by
id; future versions do not retroactively change existing conversations.

## Create and Enable an Assistant

```bash
ASSISTANT_ID=$(
  curl -s -X POST /admin/ai/assistants \
    -H 'Authorization: Bearer <fresh-admin-jwt>' \
    -H 'Content-Type: application/json' \
    --data-binary @- <<'JSON' | jq -r '.id'
{
  "slug": "support",
  "displayName": "Support assistant",
  "enabled": false,
  "systemPrompt": "You are a concise support assistant for this product.",
  "modelSelection": { "modelSlug": "claude-default", "fallback": [] },
  "allowedModalities": ["text"],
  "toolAllowlist": []
}
JSON
)

curl -X PATCH /admin/ai/assistants/$ASSISTANT_ID \
  -H 'Authorization: Bearer <fresh-admin-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'
```

Bind it when creating a conversation:

```bash
curl -X POST /ai/conversations \
  -H 'Authorization: Bearer <user-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "assistantId": "$ASSISTANT_ID",
  "title": "Support"
}
JSON
```

## Publish a New Version

Behavioral config is immutable. Change prompt/model/tools/modalities by publishing
a new version:

```bash
curl -X POST /admin/ai/assistants/support/versions \
  -H 'Authorization: Bearer <fresh-admin-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "displayName": "Support assistant",
  "enabled": true,
  "systemPrompt": "You are a concise support assistant. Ask one clarifying question when required.",
  "modelSelection": { "modelSlug": "claude-default", "fallback": [] },
  "allowedModalities": ["text", "image", "pdf"],
  "toolAllowlist": ["current_time"]
}
JSON
```

Only `enabled` and `displayName` are patchable in place.

## Operational Rules

- `enabled` is a kill switch. Disabled assistants cannot be bound or start new
  runs; a queued run fails at execution if its assistant is disabled before the
  worker reaches it.
- `systemPrompt` is trusted admin text, but AMCore always appends the structural
  trust-boundary policy. Assistant prompts cannot weaken user/tool/file isolation.
- `modelSelection` is credential-gated. A pinned assistant model with no usable
  credential fails run creation instead of silently falling back to `mock`.
- `toolAllowlist` intersects with the code-owned tool registry; listing an
  unknown tool does not create it.
- `allowedModalities` gates artifacts at run creation. Use `["text"]` for
  text-only assistants and add `"image"` / `"pdf"` only when the selected model
  supports those capabilities.

The `/admin/ai/assistants` endpoint shapes are in the OpenAPI document at `/docs`.
All assistant admin reads require SUPER_ADMIN; all writes additionally require
**fresh auth** and reject API keys. Only `enabled` and `displayName` are patchable
in place — every other config change is a new immutable version.
