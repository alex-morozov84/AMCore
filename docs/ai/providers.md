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
- Direct gateway usage writes are best-effort; durable runs settle usage atomically
  with their guarded outcome. Both are content-free.
- Metrics never label by model slug, user id, run id, prompt, response, or
  credential.

## Frozen execution and live permission

New runs persist a strict version-1 executable descriptor: model/provider row IDs,
original diagnostic slugs, wire model name, capabilities, context/output limits,
logical credential slot and endpoint binding. Editing a name, capability or limit
on those same rows affects future runs. Existing runs retain their frozen values.
Deleting/recreating a row under the same slug, reassigning its provider or changing
the provider family, slot or compatible endpoint refuses the existing run with
`model_binding_changed`; it cannot silently execute as a replacement model.

Before every call the gateway reads enabled model/provider identity from primary
Postgres. The worker then checks the lease, conversation ownership, stop causes
and current assistant binding/enabled state under its final admission guard.
These are admission checks, not a guarantee that an operator mutation can recall
an already-admitted request. The adapter resolves the current secret only after
admission: rotating a secret in the same allowed slot is supported.

Built-in families ignore DB `baseUrl`. Custom compatible endpoints require HTTPS,
or HTTP at the literal loopback hosts `localhost`, `127.0.0.1`, `[::1]` for local
services. URLs are bounded to 2048 characters and reject credentials, whitespace,
query strings and fragments; redirects fail rather than forwarding the secret.
The descriptor stores a SHA-256 binding of the canonical URL, never the URL itself.
An endpoint hash is an identity check, not a substitute for deployment egress/DNS
policy. Adding another credential slot requires a code-owned allowlist extension.

## Bounded catalogue degradation

Redis remains an optimization. Per process, at most four issued cache commands
are outstanding; each caller waits at most 250 ms, with a 1 s cooldown and one
probe. An already-issued command retains its permit until its actual promise
settles. Cache data is bounded to 1 MiB/1024 models. Flat PG loading reads at most
1025 rows to detect overflow without an unbounded provider include.

Fallback has one physical PG load, 64 detachable waiters, a 2 s caller budget,
at most one new start per second and 1 s reuse of a healthy result. A caller's
exhausted selection budget or catalogue overflow returns HTTP 503 with
`catalogue_unavailable`, without dispatching a provider request. A caller's
abort never cancels another waiter. No remaining waiter, invalidation or shutdown
prevents further application queries and cache fills. A generation token captured
before loading and Redis Lua compare-and-set prevent an old fill from undoing a
successful invalidation. Failed cross-process invalidation retains ordinary soft
TTL staleness; fresh primary execution permission still applies.

A Prisma timeout does not prove pool acquisition, BEGIN or cleanup finished.
The private adapter-bound client releases the load only after acknowledged terminal
SQL, driver release and logical settlement. Unknown physical completion quarantines
that capability until process restart; it does not repeatedly start new loads after
cooldown. See [deployment](../operations/deployment.md#graceful-shutdown).
