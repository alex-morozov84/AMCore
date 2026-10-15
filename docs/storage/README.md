# Storage

AMCore ships a cloud-agnostic storage layer for user files, avatars, exports,
and future feature modules. The API talks to `StorageService`; the active driver
is selected by `STORAGE_DRIVER`.

## What Is Included

| Area       | Built-in behavior                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Drivers    | S3-compatible production driver, local filesystem production/development driver, in-memory test driver |
| Safety     | Private by default (the key namespace decides), object-key traversal guard, no guaranteed upload URL   |
| Validation | Server-side magic-byte validation with image/document presets                                          |
| URLs       | URL generation for public objects; signed URLs only on drivers that support them                       |
| Downloads  | Reusable app-mediated download primitive for authorized consumers                                      |
| Health     | Independent active file checks and a public-delivery check; separately opt-in readiness                |
| Avatar     | `POST/DELETE /auth/me/avatar` as the public-file example consumer                                      |

## Mental Model

```
Application code
  -> StorageService
      -> MemoryStorageProvider  (tests)
      -> LocalStorageProvider   (production / development)
      -> S3StorageProvider      (production / S3-compatible)
```

Every key outside the reserved `public/` namespace is private; a key under `public/`
is public. The key is the visibility (see [Public Files](./public-files.md)).
`upload()` returns object metadata, not a URL. Callers choose the access path explicitly:

- `getPublicUrl(key)` for stable public/CDN URLs of `public/` keys.
- `getSignedDownloadUrl({ key })` for time-limited provider URLs.
- `StorageDownloadService` for authenticated app-mediated streaming after the
  caller has performed authorization.

`getPublicUrl(key)` builds an address from `STORAGE_PUBLIC_BASE_URL`; it never calls
the provider and cannot know whether the provider serves the file. Making the
`public/` namespace readable is an operator step on the provider, and a private key
has no public URL. Verify the result with the steps in
[Public Files](./public-files.md#verify-the-setup).

## Quick Start

Development defaults to local storage and needs no storage variables:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
# STORAGE_PUBLIC_BASE_URL defaults to http://localhost:<API_PORT>/api/v1/storage/public
```

Local storage is also supported in production with an explicit `STORAGE_DRIVER=local`,
a persistent shared volume and an explicit `STORAGE_PUBLIC_BASE_URL`; see
[Configuration](configuration.md#local-production).

Outside Docker Compose, production defaults to S3 when no driver is selected and
fails to boot without bucket credentials and a public base URL. Compose supplies
`local` by default even in production, so choose the driver explicitly for a
production rollout:

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=<access-key-id>
STORAGE_SECRET_ACCESS_KEY=<secret-access-key>
STORAGE_PUBLIC_BASE_URL=https://cdn.example.com
```

For S3-compatible providers also set `STORAGE_ENDPOINT` and the provider's region.
Publish the public location as described in [Public Files](./public-files.md). See
[Configuration](./configuration.md).

## Guides

- [Configuration](./configuration.md) — env vars and provider examples.
- [Public Files](./public-files.md) — the `public/` namespace, delivery modes, publishing and verification.
- [Uploads](./uploads.md) — validated uploads, avatar flow, presigned upload caveats.
- [API Reference](./reference.md) — `StorageService` methods and error behavior.
- [Providers](./providers.md) — provider differences and gotchas.

## HTTP upload and download integration

The API uses Nest’s Fastify multipart interceptors with explicit per-route file
limits. Storage validation remains independent of HTTP parsing. Authorized
downloads return Nest-managed `StreamableFile` responses with full object bytes,
safe attachment headers and metadata. The primitive ignores Range and does not
implement conditional 304 responses. Do not hijack its response. The focused
transport tests cover GET; verify HEAD behavior for the actual consumer. See
[HTTP runtime](../backend/http-runtime.md) before adding a consumer.
