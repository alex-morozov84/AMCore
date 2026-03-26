# API Keys

API keys are for server-to-server access — scripts, integrations, CI pipelines, and any situation where a human isn't logging in interactively. Instead of a user session, you use a long-lived token scoped to exactly what it needs.

---

## How API keys differ from user tokens

|                 | JWT (user session)                 | API key                        |
| --------------- | ---------------------------------- | ------------------------------ |
| **Issued via**  | Login flow                         | Created in settings            |
| **Lifetime**    | 15 min (access) / 7 days (refresh) | Set at creation (or no expiry) |
| **Permissions** | Full user permissions              | User permissions ∩ key scopes  |
| **Use case**    | Interactive apps                   | Automation, scripts            |
| **Revocable**   | Revoking a session                 | Deleting the key               |
| **Header**      | `Authorization: Bearer {token}`    | `X-API-Key: {token}`           |

---

## Scopes

When you create an API key, you define its **scopes** — the exact operations it's allowed to perform. Even if the user has full admin permissions, the key can't do more than its scopes allow.

Scopes use the format `action:subject`:

| Scope            | What it allows     |
| ---------------- | ------------------ |
| `read:Contact`   | Read contacts      |
| `create:Contact` | Create contacts    |
| `update:Contact` | Update contacts    |
| `delete:Contact` | Delete contacts    |
| `read:User`      | Read user profiles |

**Effective permissions** = user's org permissions **intersected with** key scopes.

```
User can:    read:Contact, update:Contact, delete:Contact, read:User
Key scopes:  read:Contact, create:Contact

Effective:   read:Contact  ← only the overlap
```

This means: if the user loses the `update:Contact` permission later, the key also loses it — even though the key's scopes still list it.

---

## Creating an API key

**Endpoint:** `POST /api/v1/api-keys`

```bash
curl -X POST https://api.amcore.dev/api/v1/api-keys \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI Pipeline",
    "scopes": ["read:Contact", "create:Contact"],
    "expiresAt": "2025-01-01T00:00:00.000Z"
  }'
```

**Success response** `201 Created`:

```json
{
  "id": "key_abc123",
  "name": "CI Pipeline",
  "token": "amk_a1b2c3d4e5f6...",
  "shortToken": "amk_a1b2**",
  "scopes": ["read:Contact", "create:Contact"],
  "expiresAt": "2025-01-01T00:00:00.000Z",
  "createdAt": "2024-03-20T10:00:00.000Z"
}
```

> **Copy the token now.** The full `token` value is only shown once at creation. The backend only stores a hash — there's no way to retrieve the raw token later.

The `shortToken` (`amk_a1b2**`) is the display version for UI listings — safe to show since it can't be used.

---

## Using an API key

Send the token in the `X-API-Key` header:

```bash
curl https://api.amcore.dev/api/v1/contacts \
  -H "X-API-Key: amk_a1b2c3d4e5f6..."
```

Most endpoints accept **either** a JWT or an API key. The endpoint documentation notes when only one is accepted.

---

## Listing API keys

**Endpoint:** `GET /api/v1/api-keys`

Returns all keys for the authenticated user. The `token` field is never returned here — only the `shortToken`.

```bash
curl https://api.amcore.dev/api/v1/api-keys \
  -H "Authorization: Bearer eyJhbGci..."
```

```json
{
  "apiKeys": [
    {
      "id": "key_abc123",
      "name": "CI Pipeline",
      "shortToken": "amk_a1b2**",
      "scopes": ["read:Contact", "create:Contact"],
      "expiresAt": "2025-01-01T00:00:00.000Z",
      "lastUsedAt": "2024-03-19T08:15:00.000Z",
      "createdAt": "2024-03-01T10:00:00.000Z"
    }
  ]
}
```

---

## Revoking an API key

**Endpoint:** `DELETE /api/v1/api-keys/:keyId`

```bash
curl -X DELETE https://api.amcore.dev/api/v1/api-keys/key_abc123 \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response:** `204 No Content`

The key is immediately invalid — any in-flight request using it will fail.

---

## Security notes

**Store keys like passwords.** Anyone who has your API key can make requests as you (within its scopes). Don't:

- Commit keys to Git
- Put them in client-side code
- Log them in application logs
- Share them in Slack/email

**Use environment variables** on your server:

```bash
export AMCORE_API_KEY="amk_a1b2c3d4e5f6..."
```

**Set expiry dates** for keys used in temporary contexts (a one-off migration, a contractor's access).

**Use the narrowest scopes possible.** A key for reading reports doesn't need `delete:Contact`.
