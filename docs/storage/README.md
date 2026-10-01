# Storage

AMCore ships a cloud-agnostic storage layer for user files, avatars, exports,
and future feature modules. The API talks to `StorageService`; the active driver
is selected by `STORAGE_DRIVER`.

## What Is Included

| Area       | Built-in behavior                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Drivers    | S3-compatible production driver, local filesystem production/development driver, in-memory test driver |
| Safety     | Private-by-default uploads, object-key traversal guard, no guaranteed upload URL                       |
| Validation | Server-side magic-byte validation with image/document presets                                          |
| URLs       | URL generation for public objects; signed URLs only on drivers that support them                        |
| Downloads  | Reusable app-mediated download primitive for authorized consumers                                      |
| Health     | Independent active file checks; separately opt-in readiness                                            |
| Avatar     | `POST/DELETE /auth/me/avatar` as the public-read example consumer                                      |

## Mental Model

```
Application code
  -> StorageService
      -> MemoryStorageProvider  (tests)
      -> LocalStorageProvider   (production / development)
      -> S3StorageProvider      (production / S3-compatible)
```

Uploads are private unless a caller explicitly passes
`visibility: 'public-read'`. `upload()` returns object metadata, not a URL.
Callers choose the access path explicitly:

- `getPublicUrl(key)` for stable public/CDN URLs.
- `getSignedDownloadUrl({ key })` for time-limited provider URLs.
- `StorageDownloadService` for authenticated app-mediated streaming after the
  caller has performed authorization.

`getPublicUrl(key)` builds an address; it does not check the object's visibility.
Call it only for deliberately public objects. The local public endpoint checks
visibility before serving bytes; S3 public access depends on the bucket/CDN
policy and the object's ACL. Never return a generated public URL for a private
object.

## Quick Start

Development defaults to local storage:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
STORAGE_LOCAL_PUBLIC_BASE_URL=http://localhost:5002/api/v1/storage/public
```

Local storage is also supported in production with an explicit `STORAGE_DRIVER=local`
and a persistent shared volume; see [Configuration](configuration.md#local-production).

Outside Docker Compose, production defaults to S3 when no driver is selected and
fails to boot without bucket credentials. Compose supplies `local` by default
even in production, so choose the driver explicitly for a production rollout:

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

For S3-compatible providers, also set `STORAGE_ENDPOINT` and usually
`STORAGE_PUBLIC_ENDPOINT`. See [Configuration](./configuration.md).

## Guides

- [Configuration](./configuration.md) — env vars and provider examples.
- [Uploads](./uploads.md) — validated uploads, avatar flow, presigned upload caveats.
- [API Reference](./reference.md) — `StorageService` methods and error behavior.
- [Providers](./providers.md) — provider differences and gotchas.
