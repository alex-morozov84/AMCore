# S3-compatible providers

AMCore talks to any provider that speaks the S3 API. Providers differ in how they **publish files
to the internet**, and that is the part you must set up yourself. This page shows the differences
side by side. Each provider has its own page.

Read [Public Files](../public-files.md) first: it explains the `public/` namespace, the three delivery
modes and the bucket layouts that the columns below refer to.

## How to read the status

| Status                  | Meaning                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| **Verified** (date)     | A maintainer ran `storage:check` against the real service on that date.                            |
| **Verified emulator**   | A maintainer ran the wire tests against that emulator. An emulator cannot prove ACLs or CDN rules. |
| **Provider-documented** | We read the provider's own documentation (date on the page). Nobody has run AMCore against it.     |
| **Closed**              | The project is no longer maintained, so we do not recommend it.                                    |

"Provider-documented" is not a promise that it works. It means the setup below is what the provider
says should work. Run [`storage:check`](../testing.md#check-a-real-provider-with-storagecheck)
against your own account; it takes a minute and tells you if anything is wrong.

## Matrix

"Whole bucket" means the provider can only publish an entire bucket, so use a separate public
bucket ([two-bucket layout](../public-files.md#choose-the-layout)). "Prefix" means you can publish
only `public/` inside one bucket.

| Provider                                                    | Publish                      | Object ACL (`acl` mode) | Bucket policy | Status                                 |
| ----------------------------------------------------------- | ---------------------------- | ----------------------- | ------------- | -------------------------------------- |
| [Yandex Object Storage](yandex.md)                          | Prefix (flag **and** policy) | Works on a plain bucket | Yes           | **Verified 2026-10-15**                |
| [AWS S3](aws.md)                                            | Prefix, or CloudFront        | Off by default          | Yes           | Provider-documented                    |
| [Cloudflare R2](cloudflare-r2.md)                           | Whole bucket                 | No                      | No            | Provider-documented                    |
| [Backblaze B2](backblaze-b2.md)                             | Whole bucket                 | Bucket level only       | —             | Provider-documented                    |
| [DigitalOcean Spaces](digitalocean-spaces.md)               | Object or policy             | Yes                     | Yes           | Provider-documented                    |
| [Wasabi](wasabi.md)                                         | Needs a support request      | —                       | Required      | Provider-documented                    |
| [Hetzner](hetzner.md)                                       | Unclear                      | Unclear                 | Partial       | Provider-documented                    |
| [Scaleway](scaleway.md)                                     | Object or bucket             | Yes                     | Yes           | Provider-documented                    |
| [Selectel](selectel.md)                                     | Whole bucket                 | No                      | Yes           | Provider-documented                    |
| [VK Cloud](vk-cloud.md)                                     | Whole bucket (ACL)           | Yes                     | No            | Provider-documented                    |
| [Cloud.ru](cloud-ru.md)                                     | Whole bucket                 | Bucket level            | Yes           | Provider-documented                    |
| [Timeweb Cloud](timeweb.md)                                 | Bucket                       | Bucket level            | Yes           | Provider-documented                    |
| [MWS](mws.md)                                               | Policy                       | No                      | Yes           | Provider-documented                    |
| [Beget](beget.md)                                           | Bucket                       | —                       | Yes           | Provider-documented                    |
| [Self-hosted: SeaweedFS, Garage and others](self-hosted.md) | Varies                       | Accepted and ignored    | Varies        | SeaweedFS and Garage verified emulator |

A dash means we found no statement in the provider's documentation.

## Which mode should I use?

```text
Provider has bucket policies   -> external   (publish the prefix, or a public bucket)
Provider has only bucket ACLs  -> external   (make the PUBLIC bucket public once, in the console)
Provider supports object ACLs  -> acl        (optional; only if you do not want to touch the bucket)
You cannot publish anything    -> api        (the application serves public files itself; costs bandwidth)
```

`external` is the default and works everywhere that you can publish a location. If in doubt, use it
and run `storage:check`.

## Presigned URLs and CDNs

Signed (private) addresses must point at the provider's real S3 API, not at a CDN. Put the CDN only
in `STORAGE_PUBLIC_BASE_URL`. See [Configuration](../configuration.md#s3-compatible-storage).

## Add a provider you use

If you ran `storage:check` on a provider that is not verified here, open an issue or a pull request
with the date, the mode, the bucket layout and the output (without credentials). We will mark the
provider **Verified** with your date.
