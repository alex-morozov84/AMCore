# Storage

AMCore ships a cloud-agnostic storage layer for user files, avatars, exports,
and future feature modules. The API talks to `StorageService`; the active driver
is selected by `STORAGE_DRIVER`.

## What Is Included

| Area       | Built-in behavior                                                                         |
| ---------- | ----------------------------------------------------------------------------------------- |
| Drivers    | S3-compatible production driver, local filesystem dev driver, in-memory test driver       |
| Safety     | Private-by-default uploads, object-key traversal guard, no guaranteed upload URL          |
| Validation | Server-side magic-byte validation with image/document presets                             |
| URLs       | Public URLs only for `public-read` objects; signed URLs only on drivers that support them |
| Downloads  | Reusable app-mediated download primitive for authorized consumers                         |
| Health     | Opt-in readiness probe for storage-dependent deployments                                  |
| Avatar     | `POST/DELETE /auth/me/avatar` as the public-read example consumer                         |

## Mental Model

```
Application code
  -> StorageService
      -> MemoryStorageProvider  (tests)
      -> LocalStorageProvider   (development)
      -> S3StorageProvider      (production / S3-compatible)
```

Uploads are private unless a caller explicitly passes
`visibility: 'public-read'`. `upload()` returns object metadata, not a URL.
Callers choose the access path explicitly:

- `getPublicUrl(key)` for stable public/CDN URLs.
- `getSignedDownloadUrl({ key })` for time-limited provider URLs.
- `StorageDownloadService` for authenticated app-mediated streaming after the
  caller has performed authorization.

## Quick Start

Development defaults to local storage:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
STORAGE_LOCAL_PUBLIC_BASE_URL=http://localhost:3001/static
```

Production defaults to S3. An unconfigured production boot fails fast instead of
silently writing to local disk:

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
