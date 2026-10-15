# Public Files

Most files are private. A few must be readable by anyone without signing in, for
example generated avatar images. This guide defines how AMCore marks a file
public, what the operator must do on the provider, and how to check the result.

## The contract

1. **The key is the visibility.** Every key that starts with `public/` is public.
   Every other key is private. There is no per-object flag to forget.
2. `StorageService` and every driver enforce this. Uploading `public/...` as
   `private`, or any other key as `public-read`, throws `InvalidObjectKeyError`.
   `copy()` and `move()` never cross the boundary in either direction. To make a
   private file public, upload the validated bytes again under a `public/` key.
3. `getPublicUrl(key)` accepts only `public/` keys. A private key has no public URL.
4. The application publishes nothing on its own in the default mode. You make the
   `public/` namespace readable on the provider; AMCore never changes a bucket
   policy, a public-access setting or an ACL of a bucket.
5. `getMetadata().visibility` reports what the application intended (derived from
   the key). It does not prove the provider serves the file: that depends on your
   provider setup. Check it as described [below](#verify-the-setup).

```text
bucket "private"   avatars/<user>/v-1-x/original        (private: EXIF intact)
bucket "public"    public/avatars/<user>/v-1-x/avatar-256.webp   (generated copy)
                   ^^^^^^^ everything you publish lives under this prefix
```

## Choose the layout

| Layout                                   | When to use it                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| **Two buckets** (recommended)            | Works on every provider, because publicity is a property of a whole bucket.     |
| One bucket, publish the `public/` prefix | Only where the provider's bucket policy can target a prefix (AWS, Yandex, ...). |

With two buckets set `STORAGE_PUBLIC_BUCKET` to the public one. The public bucket
then holds only `public/...` keys, and a CDN or custom domain can point at it
alone. With one bucket leave `STORAGE_PUBLIC_BUCKET` empty and publish only the
`public/` prefix: a rule on the whole bucket would also publish private files.

`STORAGE_PUBLIC_BASE_URL` is the browser address of the **root of the public
bucket**; AMCore appends the key. With a public bucket at
`https://assets.example.com`, the avatar URL is
`https://assets.example.com/public/avatars/<user>/v-1-x/avatar-256.webp`.

## Delivery modes

`STORAGE_PUBLIC_DELIVERY` selects how `public/` objects become readable.

### `external` (default)

The application never sends an ACL. You publish the public location with the
provider's own tools. It works on every provider that can publish a bucket or a prefix:
AWS default buckets, Cloudflare R2, Backblaze B2, Selectel and MWS reject or lack object
ACLs, so they need this mode or `api`.

### `acl` (opt-in)

The application sends `public-read` with each `public/` upload and with copies of
`public/` keys. Use it only if your provider enforces per-object ACLs and you want
that mechanism (Yandex Object Storage, DigitalOcean Spaces and VK Cloud document
it). Two risks make it a deliberate choice:

- AWS default buckets answer `AccessControlListNotSupported`; R2 reports
  `NotImplemented`; B2 accepts only bucket-level ACLs.
- Some servers (SeaweedFS and Garage, measured) accept the header and **ignore**
  it. The upload succeeds and the file stays private. Always [verify](#verify-the-setup).

### `api`

The API serves `public/` objects itself. The unauthenticated route
`GET /api/v1/storage/public?key=<key>` reads the object from the storage with the
application's own credentials and streams it, so **nothing has to be public on the
provider**: the buckets stay private, no bucket policy, public-access setting, ACL or CDN
origin is involved. It is the only mode that works on every provider, including accounts
that cannot publish a bucket at all (Wasabi accounts created after 2023-03-13, locked-down
AWS organizations).

Set `STORAGE_PUBLIC_BASE_URL` to the absolute address of that route as a browser reaches
it, for example `https://api.example.com/api/v1/storage/public`. Public URLs then have the
form `<base>?key=public%2Favatars%2F...`. The route behaves like this:

- it serves only keys under `public/`; any other key, a traversal attempt or a missing
  object answers 404, and a storage fault answers 500 without provider text;
- it sets `X-Content-Type-Options: nosniff`, a sandbox `Content-Security-Policy` and
  `Cross-Origin-Resource-Policy: cross-origin` (so a web app on another origin can show the
  image), and it serves anything except a small allow-list of image, PDF and plain-text types
  as an opaque download;
- `Cache-Control` is the value stored with the object (versioned avatars are stored
  `immutable`), and `no-store` for an object without one. `ETag` is sent when the driver
  knows it; conditional requests are not answered with 304;
- it has its own limit of 600 requests per minute (burst 300) for each address, so a page
  with dozens of avatars does not hit the default limit.

The price is that every public file passes through the API: bandwidth, CPU and two storage
requests per uncached request (a metadata `HEAD` and the `GET` of the body), both billed as
reads by most providers. Immutable cache headers keep that low for avatars; put a CDN in
front of the route for real traffic. Use `external` with a CDN when you can, and `api` when
you cannot publish a bucket or want the simplest possible setup.

The local driver always serves public files through this route and ignores
`STORAGE_PUBLIC_DELIVERY`.

## Publish the location

Replace every `<...>`. These are structural examples taken from the providers'
documentation and were not run by the maintainers.

### AWS S3

Keep Block Public Access and ACLs at their defaults and put CloudFront in front of
the public bucket with **origin access control**. The bucket stays private to the
internet and only the distribution reads it. Set `STORAGE_PUBLIC_BASE_URL` to the
distribution domain.

To publish a prefix without CloudFront, turn off _Block public access_ for that
bucket's policy settings and attach:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForPublicPrefix",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/public/*"
    }
  ]
}
```

Then `STORAGE_PUBLIC_BASE_URL=https://<bucket>.s3.<region>.amazonaws.com`.
Never grant `GetObject` on `arn:aws:s3:::<bucket>/*` in a bucket that also holds
private files.

### Yandex Object Storage

A bucket policy with the same statement shape publishes the prefix (the policy
uses the `arn:aws:s3:::<bucket>/public/*` resource form). Alternatively make a
dedicated public bucket. Set `STORAGE_PUBLIC_BASE_URL` to
`https://<bucket>.storage.yandexcloud.net` or your CDN.

### Providers that publish a whole bucket

Use a separate public bucket and mark **that bucket** public:

| Provider      | How to publish the bucket                                                           | `STORAGE_PUBLIC_BASE_URL`                       |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| Cloudflare R2 | Attach a custom domain to the bucket (`r2.dev` is rate-limited, development only)   | `https://assets.example.com`                    |
| Backblaze B2  | Set the bucket type to public                                                       | `https://f<NNN>.backblazeb2.com/file/<bucket>`  |
| Selectel      | Create a public bucket; use its public domain or a custom domain                    | `https://<bucket-uuid>.selstorage.ru`           |
| VK Cloud      | Set the **bucket** ACL to `public-read` (no policies on this provider)              | `https://<bucket>.hb.ru-msk.vkcloud-storage.ru` |
| Cloud.ru      | Make the bucket public (policy or `AllUsers` bucket ACL after the ownership change) | `https://<bucket>.s3.cloud.ru`                  |

Do not put private files into a bucket you publish this way.

### Wasabi and locked-down accounts

Wasabi accounts created after 2023-03-13 cannot enable public access without a
support request, and some organizations forbid public buckets. Then no `external`
setup is possible. Use the [`api` mode](#api), or put a CDN with origin authentication in
front of the bucket.

## Verify the setup

A healthy [file check](configuration.md#active-file-monitoring-and-readiness)
proves private write/read/delete. It does not prove that public delivery works.
Three tools cover that.

**The public-delivery check** runs inside every API process that uses the `s3` driver
(`STORAGE_PUBLIC_CHECK_ENABLED`, on by default; a dedicated worker skips it because the
result depends on the deployment, not on the process). At start-up it writes two
fixed canary objects, one under `public/` and one private. Every
`STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS` (one hour by default) it then only reads:

1. The public canary must be served anonymously at `STORAGE_PUBLIC_BASE_URL` with its
   own bytes. A 403 or 404 means nothing publishes the namespace; in `acl` mode it also
   catches a server that accepted the ACL and ignored it.
2. The private canary must be refused (401, 403 or 404) when requested from the storage
   API without credentials. A 2xx means the private bucket is open to everyone.
3. With **one** bucket, the private canary must also be refused at the public base. With
   two buckets this request would test nothing, because the private key never exists in
   the public bucket, so the check does not make it.

The result is the metrics `storage_public_check_state` and `storage_private_exposed`
(alerts `AMCoreStoragePublicDeliveryFailed` and `AMCoreStoragePrivateExposed`) and the
log events `storage_public_check_failed` and `storage_public_check_recovered`, written
when the state changes. It never affects API readiness. See the
[runbook](../operations/runbooks/storage.md#public-delivery).

**The operator command** runs the same checks on demand, plus presigned download and
upload, multipart upload, copy, list and cleanup, against the configured provider. It
prints PASS, FAIL or SKIP per step and never prints credentials, endpoints or provider
messages. Use it after every setup change and once on every new provider:

```bash
pnpm --filter api storage:check      # from a checkout
node dist/cli/storage-check.js       # from the production image
```

**A manual check** still matters for what the application cannot see. A public domain
or website endpoint that you bound to the **private** bucket outside AMCore is not
covered by the requests above; never bind one. After a change, upload an avatar, copy
its `avatarUrl` and open it in a private browser window (no cookies): it must show the
image. In the web app the avatar must also render: if it does not, check that
`WEB_PUBLIC_FILES_ORIGIN` equals the origin of `STORAGE_PUBLIC_BASE_URL` (a blocked image
shows up as a CSP `img-src` report).

## Failure reference

| Symptom                                                   | Cause                                                      | Fix                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Upload fails with `AccessControlListNotSupported`         | `acl` mode on a bucket with ACLs disabled (AWS default)    | Use `external` and publish the location                                                         |
| Upload fails with `NotImplemented` mentioning `x-amz-acl` | `acl` mode on a provider without object ACLs (R2, ...)     | Use `external`                                                                                  |
| Upload succeeds, the image URL answers 403                | Nothing publishes `public/`, or the server ignored the ACL | Publish the location; in `acl` mode switch to `external`. The check reports `public_not_served` |
| Alert `AMCoreStoragePrivateExposed`                       | The check read a private canary without credentials        | Treat as an incident: [runbook](../operations/runbooks/storage.md#private-exposure)             |
| Image URL answers 404                                     | `STORAGE_PUBLIC_BASE_URL` does not map to the bucket root  | Compare the URL with the real object address; fix the base                                      |
| Boot error naming `STORAGE_PUBLIC_BASE_URL`               | Missing base for `s3`, or `local` in production            | Set the base                                                                                    |
| Boot error naming `STORAGE_PRESIGN_ENDPOINT`              | The value has a path (often a CDN address)                 | Use the bare S3 API origin; put the CDN in `STORAGE_PUBLIC_BASE_URL`                            |
| Presigned URL has a wrong host (`<bucket>.<your CDN>`)    | CDN used as the presign endpoint                           | Same as above                                                                                   |
