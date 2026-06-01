# Storage Providers

The provider contract is intentionally narrow and portable. It covers the common
operations a starter needs without tying application code to one cloud.

## Provider Matrix

| Provider | Intended use | Persistence          | Public URLs | Signed URLs |
| -------- | ------------ | -------------------- | ----------- | ----------- |
| memory   | unit tests   | process memory       | no          | no          |
| local    | development  | filesystem           | optional    | no          |
| s3       | production   | S3-compatible bucket | yes         | yes         |

## S3-Compatible Driver

The S3 driver is built for AWS S3 and compatible providers such as Cloudflare R2,
DigitalOcean Spaces, Yandex Object Storage, and Backblaze B2.

Notable behavior:

- checksum calculation and validation are set to `WHEN_REQUIRED` for non-AWS
  compatibility;
- `public-read` maps to object ACL plus a `visibility` metadata tag;
- `deleteMany()` chunks requests at 1000 keys;
- signed URL TTL is clamped to `STORAGE_SIGNED_URL_MAX_TTL` and the SigV4
  seven-day maximum;
- large buffers and streams use `@aws-sdk/lib-storage` multipart upload.

`STORAGE_ENDPOINT` and `STORAGE_PUBLIC_ENDPOINT` are intentionally separate.
The SDK endpoint can be internal, while public and presigned URLs should use the
browser-facing endpoint.

## Local Driver

The local driver is for development and simple forks. It stores:

```text
{root}/objects/{key}
{root}/meta/{key}.json
```

The split keeps object names like `report.meta.json` from colliding with
metadata. If a static server is mounted for public URLs, mount `objects/`, not
the root directory.

## Memory Driver

The memory driver is for unit tests and contract tests. It supports the same
core object operations but does not support public or signed URLs. Production
deployments should never use it.

## Private Downloads

There is no open `GET /storage/objects/*` route. A generic bearer-auth route
would allow any authenticated user to fetch any private object by key.

Instead, `StorageDownloadService` is an unauthorized primitive. Feature
controllers must perform ownership/scope checks first, then call:

```ts
await storageDownload.streamObject(key, response)
```

This keeps authorization close to the domain that owns the object.

## Migration Between Providers

Application code should store object keys and externally visible URLs
separately:

- keys are stable internal identifiers;
- public URLs may change when a CDN or bucket hostname changes.

For private files, store only the key. Generate signed/app-mediated access at
read time. For public avatars, AMCore stores `User.avatarUrl` because it is an
existing public profile field and the key is stable (`avatars/{userId}`).

## Future Media Processing

Image resizing, thumbnail generation, AVIF/WebP conversion, EXIF stripping, and
async derivative jobs are deliberately outside this storage module. They belong
to the separate Media Processing arc so storage remains provider-agnostic and
file-type agnostic.
