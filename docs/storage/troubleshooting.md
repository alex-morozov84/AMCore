# Troubleshooting storage

Find your symptom, read the cause, apply the fix. Start with
[`storage:check`](testing.md#check-a-real-provider-with-storagecheck): it names the failing step and
usually points straight at the cause.

## Quick table

| Symptom                                                              | Likely cause                                                    | Fix                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `AccessDenied` (403) on every call                                   | The bucket has a policy and the policy does not allow the app   | [Below](#accessdenied-on-every-call)                                                   |
| Upload works, the public URL answers 403                             | Nothing publishes `public/`, or one required setting is missing | [Below](#the-upload-works-but-the-public-file-answers-403)                             |
| Upload fails with `AccessControlListNotSupported`                    | `acl` mode on a bucket with ACLs disabled (AWS default)         | Use `external` and publish the location                                                |
| Upload fails with `NotImplemented` mentioning `x-amz-acl`            | `acl` mode on a provider without object ACLs                    | Use `external`                                                                         |
| Upload succeeds, the file stays private in `acl` mode                | The server accepted the ACL header and ignored it               | Use `external`. The public check reports `public_not_served`                           |
| Alert `AMCoreStoragePrivateExposed`, or check says `private_exposed` | The check read a private test file without credentials          | Treat it as an incident: [runbook](../operations/runbooks/storage.md#private-exposure) |
| The image URL answers 404                                            | `STORAGE_PUBLIC_BASE_URL` does not map to the bucket root       | Compare the URL with the real object address and fix the base                          |
| The avatar uploads but does not show in the web app                  | `WEB_PUBLIC_FILES_ORIGIN` differs from the public base origin   | [Below](#the-avatar-does-not-render-in-the-web-app)                                    |
| Presigned `PUT` answers 400 from a custom client                     | The client sends checksum headers the provider rejects          | Send checksums only when required (AMCore's client does)                               |
| Presigned URL has the wrong host (`<bucket>.<your CDN>`)             | A CDN is used as the signing endpoint                           | Use the bare S3 API origin for signing; put the CDN only in `STORAGE_PUBLIC_BASE_URL`  |
| Browser upload fails with a CORS error                               | The bucket has no CORS rule for your web origin                 | [Below](#browser-uploads-fail-with-a-cors-error)                                       |
| `SignatureDoesNotMatch`                                              | Wrong secret, region or endpoint, or a skewed clock             | Check the three values and the server clock                                            |
| The API does not start: error names `STORAGE_PUBLIC_BASE_URL`        | The base is missing for `s3`, or `local` is used in production  | Set the base                                                                           |
| The API does not start: error names `STORAGE_PRESIGN_ENDPOINT`       | The value has a path (often a CDN address)                      | Use the bare S3 API origin                                                             |
| A `curl` to the S3 endpoint fails with a certificate error           | The provider uses a private certificate authority               | Set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` for the API and worker                       |

## `AccessDenied` on every call

**Symptom.** Even a simple list or write fails with HTTP 403, including in `storage:check`, although
the keys and the role look right.

**Cause.** Some providers treat a bucket policy as "closed unless allowed": once a bucket has a
policy, every request the policy does not allow is denied, even from an account that has a
storage role. We measured this on Yandex: the application's service account got 403 on everything
until the policy named it, and the owner could not open the bucket in the web console until the
policy allowed the console. See [Yandex](providers/yandex.md#1-a-bucket-policy-means-closed-unless-allowed).

**Fix.**

1. Add a statement that allows the application's account to read, write, list and delete on the
   bucket and its objects.
2. Add the provider's console statement if you want to use the web console.
3. Re-run `storage:check`.

If a provider's application key also cannot read or change the policy, that is normal. Change the
policy with the provider's CLI or console.

## The upload works but the public file answers 403

**Cause.** The `public/` namespace is not published, or one of two required settings is missing.

- On most providers, publishing a prefix needs one setting (a bucket policy, or the public flag of a
  whole bucket).
- On **Yandex**, publishing a prefix needs two: the bucket's public read flag **and** a policy that
  allows reading `public/*`. With only the policy, the public file answers 403. See
  [Yandex](providers/yandex.md#2-publishing-a-prefix-needs-the-bucket-flag-and-the-policy).
- In `acl` mode, some servers accept the header and ignore it.

**Fix.** Publish the location as the [provider page](providers/README.md) describes, then re-run
`storage:check`. The public-delivery check reports `public_not_served` until it works.

## The avatar does not render in the web app

The browser may block the image through the Content Security Policy. The web app allows exactly one
extra image origin: `WEB_PUBLIC_FILES_ORIGIN`. It must equal the origin of
`STORAGE_PUBLIC_BASE_URL` (scheme and host; `https`, or `http` only for a loopback address). A
blocked image appears as a CSP `img-src` report in the browser console. A set but unusable value
stops the web server at start-up. See [Browser security and CSP](../frontend/browser-security-and-csp.md).

## Browser uploads fail with a CORS error

A presigned `PUT` from a browser needs a CORS rule on the bucket that allows your web origin and the
`PUT` method. Without it the browser blocks the request before it leaves. Check with a preflight
request (`OPTIONS`) from the allowed origin: it must answer 200 with
`access-control-allow-origin`. A request from another origin should be refused. The Yandex page shows
an executed example: [CORS](providers/yandex.md#browser-uploads-cors-executed-2026-10-15). Remember
that a presigned `PUT` does not enforce size or type; see [Uploads](uploads.md#presigned-direct-uploads).

## Still stuck

Collect `storage:check` output (without credentials), the delivery mode, whether you use one or two
buckets, and the provider. The [provider matrix](providers/README.md) shows what is verified for
your provider and what is not.
