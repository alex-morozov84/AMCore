# API Keys

API keys are for server-to-server access — scripts, integrations, CI pipelines, and any situation where a human isn't logging in interactively. Instead of a user session, you use a long-lived token bound to a specific organization and scoped to exactly what it needs.

> Replace `https://api.example.com` with your deployment URL throughout this guide.

---

## How API keys differ from user tokens

|                 | JWT (user session)             | API key                                                       |
| --------------- | ------------------------------ | ------------------------------------------------------------- |
| **Issued via**  | Login flow                     | `POST /api/v1/api-keys` (JWT-auth)                            |
| **Lifetime**    | 15 min access / 7 days refresh | Set at creation, or no expiry                                 |
| **Permissions** | Full user permissions          | `userPerms ∩ apiKey.scopes` (see Effective permissions below) |
| **Header**      | `Authorization: Bearer eyJ...` | `Authorization: Bearer amcore_live_...`                       |
| **Org context** | Picked via `/switch`           | Bound to one org at creation                                  |
| **Revocable**   | Revoking the session           | `DELETE /api/v1/api-keys/:id`                                 |

Both auth methods use the same `Authorization: Bearer` header — the server tells them apart by the token format. JWTs are `eyJ...`; API keys are `amcore_live_...`.

---

## Scopes

When you create an API key, you define its **scopes** — the exact operations it's allowed to perform. Even if the key's owner has full admin permissions, the key can't do more than its scopes allow.

### Scope format

Every scope is `action:Subject`, case-sensitive:

| Part      | Allowed values                                                      |
| --------- | ------------------------------------------------------------------- |
| `action`  | `create`, `read`, `update`, `delete`, `manage` (= all four)         |
| `Subject` | `User`, `Organization`, `Role`, `Permission`, `all` (= any subject) |

`Subject` is PascalCase for concrete types and lowercase `all` for the wildcard. Add domain subjects (e.g. `Contact`, `Deal`) by extending `packages/shared/src/enums/permissions.ts` — the scope schema picks them up automatically.

### Examples

| Scope                 | What it allows                                                   |
| --------------------- | ---------------------------------------------------------------- |
| `read:User`           | Read users in the bound org                                      |
| `manage:Organization` | Full control over the bound organization (read + write + delete) |
| `read:all`            | Read any subject in the bound org                                |
| `manage:User`         | Full control over users in the bound org                         |

### `manage:all` is rejected

`manage:all` is forbidden at the schema layer. It would mean "no narrowing" — the key would have the same power as the owner's JWT, defeating the purpose of a scoped credential. Use a narrower scope (e.g. `manage:Organization` or `read:all`), or use your JWT directly.

### Effective permissions

`Effective permissions = owner's org permissions ∩ key scopes`.

```
Owner has:        manage:Organization, read:all
Key scopes:       read:Organization

Effective rule:   read:Organization  (action narrows to read; subject stays Organization)
```

The intersection narrows along two axes (action and subject) independently. Wildcards `manage` and `all` behave as expected: `read:all ∩ read:User → read:User`, `manage:Organization ∩ read:Organization → read:Organization`.

If the owner loses a permission later, the key loses it too on the next request — there's no separate permission grant on the key itself.

---

## Creating an API key

**Endpoint:** `POST /api/v1/api-keys` — **JWT only**, API keys cannot manage credentials.

The creator must be a member of the bound organization.

```bash
curl -X POST https://api.example.com/api/v1/api-keys \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI Pipeline",
    "organizationId": "cm1abc...",
    "scopes": ["read:User", "read:Organization"],
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }'
```

| Field            | Type     | Required | Description                                        |
| ---------------- | -------- | -------- | -------------------------------------------------- |
| `name`           | string   | ✅       | Human-readable label, 1–100 chars                  |
| `organizationId` | CUID     | ✅       | The org this key is bound to; you must be a member |
| `scopes`         | string[] | ✅       | At least one canonical `action:Subject` scope      |
| `expiresAt`      | ISO date | —        | Omit for no expiry                                 |

**Success response** `201 Created`:

```json
{
  "id": "cm1xyz...",
  "name": "CI Pipeline",
  "key": "amcore_live_a1B2c3D4e5F_x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4",
  "organizationId": "cm1abc...",
  "scopes": ["read:User", "read:Organization"],
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

> **Copy the `key` value immediately.** It's only returned once at creation. The server stores a salted SHA-256 hash and there's no way to retrieve the raw key later. Lost keys must be revoked and recreated.

---

## Using an API key

Send the key in the `Authorization: Bearer` header — same as a JWT:

```bash
curl https://api.example.com/api/v1/auth/me \
  -H "Authorization: Bearer amcore_live_a1B2c3D4e5F_x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4"
```

Routes are JWT-only by default. A small, explicit allowlist of routes accepts API keys; everything else returns `401 Unauthorized` when called with one.

The allowlist (current — see "transitional" note below):

| Route group                       | API key accepted?   | Why                                                                                                                                                                                                          |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /auth/me`                    | ✅                  | Identity self-check for integrations. Stable opt-in.                                                                                                                                                         |
| `/organizations` (lifecycle/read) | ✅ _(transitional)_ | `userPerms ∩ scopes` per ADR-033. May be narrowed per-handler in a follow-up: `POST /organizations` and `GET /organizations` are likely to become JWT-only; `GET /organizations/:id` likely org-scoped only. |
| `/organizations/:id/switch`       | ❌                  | Mints a new JWT — would let a scoped key trade itself for a full-permission token.                                                                                                                           |
| `/organizations/:id/members/**`   | ✅ _(transitional)_ | Member management with `manage:Organization` scope per ADR-033. Per-handler `@CheckPolicies` is the actual authorization gate. May gain role-ownership narrowings in a follow-up.                            |
| `/organizations/:id/roles/**`     | ✅ _(transitional)_ | Org-role management with `manage:Organization` scope per ADR-033. May gain stricter org-context assertions in a follow-up; the API-key opt-in stays.                                                         |
| `/api-keys/**`                    | ❌                  | Credential management — you can't create/list/revoke keys with a key.                                                                                                                                        |
| `/auth/sessions/**`               | ❌                  | Browser session management — out of scope for integrations.                                                                                                                                                  |
| `/admin/**`                       | ❌                  | Platform-admin operations — SUPER_ADMIN-owned keys would otherwise bypass scopes (the system-role guard ignores them).                                                                                       |
| Everything else with auth         | ❌                  | JWT-only by default — bearer-only is the safe baseline.                                                                                                                                                      |

> **Transitional rows.** The three `(transitional)` rows reflect the current Stage 1c allowlist after the bearer-only default flip. Follow-up reviews of the Organizations/Admin surface (Stage 2 and Stage 4 in `ai/ORGANIZATIONS_ADMIN_REVIEW.md`) may narrow API-key access on those routes per handler — but they will not expand it. The handler-level `@CheckPolicies` decorators remain the actual authorization gate within each accepted route.

Adding API-key acceptance to a new route requires an ADR amendment to `ai/DECISIONS.md` (ADR-034) plus a matching entry in `apps/api/src/core/auth/decorators/auth-decorator-coverage.spec.ts`; the metadata test fails until both agree.

---

## Organization binding

An API key is bound to one organization at creation. The runtime re-verifies on every request that the key's owner is still a member of that organization — lose membership, lose the key.

| Scenario                                   | Result                                 |
| ------------------------------------------ | -------------------------------------- |
| Owner removed from the bound org           | `401` on next request                  |
| Bound org deleted                          | Key is cascaded; `401` on next request |
| Request targets a different org's resource | `403` from policy guard, not auth      |

Use one key per (owner, organization) pair. To grant cross-org access, issue multiple keys.

---

## Listing API keys

**Endpoint:** `GET /api/v1/api-keys` — **JWT only**.

Returns all keys for the authenticated user as a raw array. No secret fields are exposed.

```bash
curl https://api.example.com/api/v1/api-keys \
  -H "Authorization: Bearer eyJhbGci..."
```

```json
[
  {
    "id": "cm1xyz...",
    "name": "CI Pipeline",
    "organizationId": "cm1abc...",
    "scopes": ["read:User", "read:Organization"],
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "lastUsedAt": "2026-05-15T08:15:00.000Z",
    "createdAt": "2026-05-01T10:00:00.000Z"
  }
]
```

`lastUsedAt` is updated on a best-effort basis (throttled cache) — it's diagnostic, not authoritative.

---

## Revoking an API key

**Endpoint:** `DELETE /api/v1/api-keys/:keyId` — **JWT only**.

```bash
curl -X DELETE https://api.example.com/api/v1/api-keys/cm1xyz... \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response:** `204 No Content`. The key is immediately invalid; any in-flight request authenticated with it returns `401`.

---

## Validation errors

Invalid scopes are rejected at `POST /api/v1/api-keys` with `400 Bad Request` and a per-scope error in the `errors` array. Each entry's `errorCode` is machine-readable and stable across API versions; use it for frontend localization.

| Code                                 | Reason                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| `API_KEY_SCOPE_INVALID_FORMAT`       | Not `action:Subject` shape (empty, `read`, `read:User:extra`) |
| `API_KEY_SCOPE_UNKNOWN_ACTION`       | Action not in `{create, read, update, delete, manage}`        |
| `API_KEY_SCOPE_UNKNOWN_SUBJECT`      | Subject not in the registry (typo, unknown module)            |
| `API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN` | `manage:all` is rejected (see Scopes section above)           |

Example response for `{ "scopes": ["read:User", "manage:all"] }`:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "scopes.1",
      "message": "`manage:all` is forbidden — would grant unrestricted access",
      "code": "custom",
      "errorCode": "API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN"
    }
  ]
}
```

Note that the error is at `scopes.1` only — `read:User` at index 0 is valid and not reported.

---

## Authorization failures

These are separate from schema validation — they happen at request time on routes that check policies (`@CheckPolicies(can(action, Subject))`):

| Status | Cause                                                                                 |
| ------ | ------------------------------------------------------------------------------------- |
| `401`  | Key revoked, expired, owner lost org membership, or org deleted                       |
| `403`  | Authenticated successfully, but scope intersection doesn't grant the required ability |

A common case: a key with `scopes: ["read:Organization"]` calling `PATCH /api/v1/organizations/:id`. The intersection narrows action to `read`, and PATCH requires `manage`, so the policy guard returns `403`.

---

## Security notes

**Store keys like passwords.** Anyone who has your API key can make requests as the owner (within scope, within the bound org). Don't:

- Commit keys to Git
- Put them in client-side code
- Log them in application logs
- Share them in Slack or email

**Use environment variables** on your server:

```bash
export AMCORE_API_KEY="amcore_live_..."
```

**Set expiry dates** for keys used in temporary contexts (a one-off migration, a contractor's access).

**Use the narrowest scopes that work.** A read-only reporter doesn't need `manage:User`. Narrowing scopes is a one-way safety net — the intersection model means even a leaked narrow key can't escalate.

**Rotate proactively.** If a key may have been exposed, revoke and recreate. There's no key "rotation" endpoint — `DELETE` + `POST` is the rotation pattern.
