# Storage Providers

The provider contract is intentionally narrow and portable. It covers the common
operations a starter needs without tying application code to one cloud.

## Provider Matrix

| Provider | Intended use           | Persistence          | Public URLs | Signed URLs |
| -------- | ---------------------- | -------------------- | ----------- | ----------- |
| memory   | unit tests             | process memory       | no          | no          |
| local    | production/development | filesystem           | optional    | no          |
| s3       | production             | S3-compatible bucket | yes         | yes         |

## S3-Compatible Driver

The S3 driver speaks the S3 API, so it targets any S3-compatible provider. The
[configuration guide](configuration.md#provider-examples) lists variables for AWS S3,
Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Yandex Object Storage, Selectel,
VK Cloud and Cloud.ru. Those blocks come from provider documentation; the
maintainers have not run AMCore against the real services yet, so treat each as
"provider-documented" until your own check passes.

Notable behavior:

- checksum calculation and validation are set to `WHEN_REQUIRED`: with the AWS
  SDK defaults, S3-compatible servers reject the `x-amz-checksum-*` headers and
  a presigned PUT returns HTTP 400 (measured on SeaweedFS and Garage);
- visibility is the key namespace (`public/`), not an object tag or an ACL. The
  default `external` mode sends no ACL at all; `acl` mode sends `public-read` for
  `public/` keys on upload and copy ([Public Files](public-files.md));
- `deleteMany()` chunks requests at 1000 keys per bucket;
- signed URL TTL is clamped to `STORAGE_SIGNED_URL_MAX_TTL` and the SigV4
  seven-day maximum. A presigned PUT signs only the host: the content type and the
  size are **not** enforced, so validate after upload (see [Uploads](uploads.md));
- large buffers and streams use `@aws-sdk/lib-storage` multipart upload;
- connection attempts time out after 5 seconds and idle sockets after 60 seconds.

Three addresses are intentionally separate: `STORAGE_ENDPOINT` (the SDK talks to
it, may be internal), `STORAGE_PRESIGN_ENDPOINT` (the S3 API origin a browser
reaches, used only to sign) and `STORAGE_PUBLIC_BASE_URL` (the plain HTTP address
of the public bucket root). A CDN belongs only in the last one.

A provider with a private certificate authority needs that authority trusted by
Node: set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` for the API and worker.

## Local Driver

The local driver supports production and development. It stores:

```text
{root}/objects/{key}
{root}/meta/{key}.json
```

The split keeps object names like `report.meta.json` from colliding with
metadata. Keys under `public/` also get a separate copy under `{root}/public/`.
The HTTP-only `/api/v1/storage/public?key=...` route serves only this copy, never
private bytes or metadata. Never mount `objects/` or the storage root on a public
static server. Public copies consume additional local disk space and must be
backed up together with objects and metadata. Rewriting or deleting a key updates
or removes its public copy.

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
read time. For public avatars, AMCore currently stores `User.avatarUrl`, built
from `STORAGE_PUBLIC_BASE_URL` when the avatar is uploaded. Public avatar objects
use versioned keys under `public/avatars/{userId}/v-{version}/`, so a published
URL is immutable and can be cached safely.

To move to another provider or CDN, copy all objects with their keys unchanged
(`public/...` keeps its prefix), then set the new `STORAGE_PUBLIC_BASE_URL`. A
stored `avatarUrl` keeps the old host until the avatar is uploaded again, so
rewrite the stored URLs with the new base or ask users to re-upload.

## Media Processing

Image inspection, avatar resizing, WebP derivatives, orientation handling, and
metadata stripping live in the separate media infrastructure module so storage
remains provider-agnostic and file-type agnostic. Generic media assets, async
media workers, AVIF/JPEG fallback variants, and animated-image policy remain
deferred until a concrete product use case exists.
