# Storage security

This page lists the security rules of storage in one place. The mechanisms are explained in
[Public Files](public-files.md), [Uploads](uploads.md) and [Media Security](../media/security.md).

## Private by default

- Only keys that start with `public/` are public. Every other key is private. There is no
  per-object flag that someone can forget to set.
- The application never changes a bucket policy, a public-access setting or a bucket ACL. You
  publish the `public/` location yourself.
- Originals (the uploaded bytes, with their metadata) stay private. Only generated copies, such as
  resized avatars, go under `public/`. See [Media Security](../media/security.md#originals-vs-derivatives).
- There is no open download route for private objects. A feature controller checks ownership first,
  then streams the object ([Private Downloads](providers.md#private-downloads)).

## The two things that expose data

1. **A public rule that covers private files.** A rule on the whole bucket publishes private files
   too. With one bucket, publish only the `public/` prefix. With two buckets, never put private
   files into the public bucket.
2. **A public domain or website endpoint bound to the private bucket.** AMCore's checks cannot see
   this outside the application. Never bind one.

The [public-delivery check](public-files.md#verify-the-setup) reads a private test file without
credentials every hour and raises an alert if it is readable. It is a safety net, not a design.
We tested it on a real provider by opening a bucket on purpose: see the
[Yandex page](providers/yandex.md).

## Least privilege for the application account

Give the application account only what it needs:

| Needs                                | Permission                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Normal operation                     | Read, write, delete and list on the bucket (and the public bucket, if any)            |
| `acl` delivery mode                  | Also the permission to set object ACLs (for example `s3:PutObjectAcl` on AWS)         |
| `storage:check` and the hourly check | Write and read under the probe prefix (`STORAGE_PROBE_PREFIX`) and its `public/` twin |

It does **not** need permission to change bucket policies or public-access settings, and on some
providers it cannot have it. On Yandex the application key could not read or delete the bucket
policy, which is the safe default. Use one account for the application and your own account for
bucket configuration.

Use a dedicated account per environment. Rotate its key when someone who knew it leaves. After a
test, revoke the key and delete the account.

## Presigned URLs

- A presigned `PUT` signs only the host. The content type and size are **not** enforced. Validate
  after upload ([Uploads](uploads.md#presigned-direct-uploads)).
- A presigned URL is a bearer secret until it expires. The lifetime is clamped to
  `STORAGE_SIGNED_URL_MAX_TTL` and the SigV4 maximum of seven days. Keep it short.
- Signing must use the provider's S3 endpoint, never a CDN.

## Browser uploads and CORS

Allow only your web origins and only the methods you need on the bucket CORS rule. CORS decides which
web pages may call the bucket from a browser; it does not protect a presigned URL, because anyone
who holds the URL can use it from a server regardless of CORS. Keep the rule narrow anyway. See the
executed example on the [Yandex page](providers/yandex.md#browser-uploads-cors-executed-2026-10-15).

## Transport and certificates

Use HTTPS endpoints. If a provider uses a private certificate authority, make Node trust it with
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem` for the API and the worker. Do not turn off certificate
checks.

## The `api` delivery mode

The route `GET /api/v1/storage/public` is unauthenticated by design. It serves only keys under
`public/`, answers 404 for anything else, sets `nosniff` and a sandbox Content-Security-Policy,
serves non-image types as an opaque download, and has its own rate limit. Details are in
[Public Files](public-files.md#api). Put a cache in front of it for real traffic.

## When something is exposed

An `AMCoreStoragePrivateExposed` alert means a private file was readable without credentials. Follow
the [runbook](../operations/runbooks/storage.md#private-exposure): close the exposure first, then find
out what was reachable and for how long.
