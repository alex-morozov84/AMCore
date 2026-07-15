# AI Providers and Models

AMCore uses a DB-backed provider/model catalog plus env-based credentials. The
catalog is seeded so a fresh fork sees the intended shape without storing any
secret in the database.

Provider/model/policy admin HTTP endpoints are intentionally deferred to the
future admin-console phase. Until then, customize providers/models through seed
data or explicit Prisma/data migrations.

## Seeded Catalog

`pnpm --filter api db:seed` seeds:

- `mock` — enabled, key-less, deterministic dev/test provider.
- `anthropic` — enabled; `claude-default` is the default model and is gated on
  `ANTHROPIC_API_KEY`.
- `openai`, `openrouter`, `local-openai-compatible`, `yandex-ai-studio` —
  disabled examples showing how to wire each family.

## Credential Mapping

| Provider type       | Credential env var             | Notes                                                                 |
| ------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `ANTHROPIC`         | `ANTHROPIC_API_KEY`            | Seeded default; `claude-default` includes text/tools/vision/pdf.      |
| `OPENAI`            | `OPENAI_API_KEY`               | OpenAI-compatible adapter with code-owned base URL.                   |
| `OPENROUTER`        | `OPENROUTER_API_KEY`           | OpenRouter base URL is code-owned.                                    |
| `OPENAI_COMPATIBLE` | `AI_OPENAI_COMPATIBLE_API_KEY` | Use for a custom compatible endpoint; this type may use DB `baseUrl`. |
| `YANDEX_AI_STUDIO`  | `YANDEX_API_KEY`               | Uses Yandex API-key auth and folder-style model ids.                  |
| `MOCK`              | none                           | Deterministic fallback; text/tool-only.                               |

The DB row stores a logical `credentialSlot`, not an env var name. Code maps that
slot to a fixed env key for the provider type.

## Add or Change a Model

When adding a model row:

- choose a stable public `slug` (`claude-default`, `gpt-default`, `local-model`);
- store the provider's real model identifier in `providerModelName`;
- set only true capabilities (`text`, `tools`, `structured_output`, `vision`,
  `pdf`, etc.);
- enable the provider and model only when the matching env credential/config
  exists;
- mark at most one usable model as `isDefault` for the intended default path.

Models are selected by slug. A bound assistant's `modelSelection` is
credential-gated: AMCore tries the primary slug, then fallbacks, and uses the
first enabled + credentialed candidate.

## Add a New Provider Family

Use the built-in families where possible. Adding a genuinely new provider family
requires:

1. a new provider enum value and schema support;
2. a gateway adapter under `apps/api/src/infrastructure/ai/gateway/providers/`;
3. credential-slot mapping;
4. capability/error normalization tests.

Do not use a DB `baseUrl` to redirect credentials for built-in provider families.
Only `OPENAI_COMPATIBLE` is designed for custom endpoints.

## Runtime Behavior

- The web role never calls providers.
- The worker resolves the frozen model snapshot for each run.
- Gateway errors are normalized to bounded codes with retryability.
- Usage ledger rows are best-effort and content-free.
- Metrics never label by model slug, user id, run id, prompt, response, or
  credential.
