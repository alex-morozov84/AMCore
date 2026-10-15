# Yandex Object Storage

**Status: verified on 2026-10-15** with `storage:check` against a real Yandex Cloud account. The
verified parts are the sections marked "executed 2026-10-15": the `external` recipe, the `acl` recipe
and the CORS rule. Everything under [What was not verified](#what-was-not-verified), and the notes on
cleaning up keys, is provider-documented or untested. See
[how to read the status](README.md#how-to-read-the-status).

Yandex has two behaviors that surprise people. Read
[Two things that surprise people](#two-things-that-surprise-people) before you attach a bucket policy.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<bucket>
STORAGE_REGION=ru-central1
STORAGE_ENDPOINT=https://storage.yandexcloud.net
STORAGE_ACCESS_KEY_ID=<static access key id>
STORAGE_SECRET_ACCESS_KEY=<static access key secret>
STORAGE_PUBLIC_BASE_URL=https://<bucket>.storage.yandexcloud.net
STORAGE_PUBLIC_DELIVERY=external
```

Create a **service account** for the application and give it the `storage.editor` role on the
folder. Create one static access key for it. Do not use your own account's keys.

## Two things that surprise people

### 1. A bucket policy means "closed unless allowed"

As soon as a bucket has a policy, everything the policy does not allow is denied. That includes
the application's own service account (even with the `storage.editor` role) and **you, in the web
console**. Without the right statements you see this:

- the application gets `AccessDenied` (HTTP 403) on every call, including a simple list;
- the web console refuses to open the bucket.

Fix it by listing both in the policy. The application statement uses the service account id:

```json
{
  "Sid": "ApplicationServiceAccount",
  "Effect": "Allow",
  "Principal": { "CanonicalUser": "<service account id>" },
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"]
}
```

The console statement comes from the
[Yandex policy documentation](https://yandex.cloud/ru/docs/storage/concepts/policy):

```json
{
  "Sid": "AllowAWSServices",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::<bucket>/*", "arn:aws:s3:::<bucket>"],
  "Condition": { "Bool": { "aws:PrincipalIsAWSService": "true" } }
}
```

The application key **cannot read or delete the policy** (`GetBucketPolicy` and
`DeleteBucketPolicy` answered 403, even though the policy grants the account `s3:*`). Plan to set
the policy with `yc` or the console.

### 2. Publishing a prefix needs the bucket flag **and** the policy

On AWS a policy that allows `s3:GetObject` on `public/*` is enough. **On Yandex it is not.** The
anonymous reader also needs the bucket's public read flag. What we measured:

| Public read flag | What the policy lets `*` (everyone) read | Public file | Private file |
| ---------------- | ---------------------------------------- | ----------- | ------------ |
| off              | `public/*`                               | 403         | 403          |
| **on**           | **`public/*`**                           | **200**     | **403**      |
| on               | the whole bucket (a deliberate mistake)  | 200         | **200**      |

The flag opens the door, and the policy narrows it to `public/`. We did not measure a bucket
that has the flag on and no policy at all. Yandex documents the flag as "opens the bucket for
public read", so assume it publishes everything. Turn the flag on only together with a policy
that lets anonymous readers read nothing but `public/`.

## Recipe: one bucket, `external` mode (executed 2026-10-15)

```bash
yc storage bucket create --name <bucket> --folder-id <folder id>
yc storage bucket update --name <bucket> --policy-from-file policy.json
yc storage bucket update --name <bucket> --public-read
```

`policy.json` has three statements: anonymous read of `public/*`, the console statement and the
application statement.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForPublicPrefix",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/public/*",
      "Condition": { "Bool": { "aws:SecureTransport": "true" } }
    },
    {
      "Sid": "AllowAWSServices",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::<bucket>/*", "arn:aws:s3:::<bucket>"],
      "Condition": { "Bool": { "aws:PrincipalIsAWSService": "true" } }
    },
    {
      "Sid": "ApplicationServiceAccount",
      "Effect": "Allow",
      "Principal": { "CanonicalUser": "<service account id>" },
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"]
    }
  ]
}
```

Then run the check from [Testing](../testing.md#check-a-real-provider-with-storagecheck):

```text
storage:check driver=s3 mode=external buckets=one
PASS  private upload, download, metadata and delete
PASS  presigned download
PASS  presigned upload
PASS  multipart upload
PASS  copy and list
PASS  public delivery and private exposure
PASS  delete many and cleanup
```

We also made a deliberate mistake to prove the alarm works. With an extra statement that let `*`
read the whole bucket, the private test file answered 200 without signing in, and the check
reported `private_exposed`. See the [runbook](../../operations/runbooks/storage.md#private-exposure).

## Recipe: `acl` mode (executed 2026-10-15)

On a **plain bucket** (no policy, no public flag) `STORAGE_PUBLIC_DELIVERY=acl` works. The
application sends `public-read` on each `public/` object and Yandex honors it:

```text
storage:check driver=s3 mode=acl buckets=one   -> 7 of 7 PASS
public file: 200    private file: 403
```

We did not test `acl` together with a bucket policy. With a policy, expect the "closed unless
allowed" rule from above to apply, so prefer `external` there.

## Browser uploads (CORS) (executed 2026-10-15)

A presigned `PUT` from a browser needs a CORS rule on the bucket:

```bash
yc storage bucket update --name <bucket> \
  --cors allowed-methods='[method-get,method-put,method-head]',allowed-origins='[https://app.example.com]',allowed-headers='[*]',max-age-seconds=300
```

Measured: the preflight from the allowed origin answered 200 with `access-control-allow-origin`;
from another origin it answered 403 `AccessForbidden`; a real presigned `PUT` with an `Origin`
header answered 200 with the CORS headers. With `STORAGE_ENDPOINT=https://storage.yandexcloud.net`
the presigned address used the `<bucket>.storage.yandexcloud.net` host, and that host worked.

## What was not verified

- Two buckets (a private bucket plus a separate public bucket).
- A CDN in front of the public bucket.
- The `api` delivery mode.
- Regions other than `ru-central1`.
- `acl` mode together with a bucket policy.
- Behavior under load.

## Cost

Yandex bills requests and storage. A full `storage:check` makes a modest number of requests and
writes one multipart file of a few megabytes, then deletes everything. Check the
[current prices](https://yandex.cloud/ru/docs/storage/pricing) before you schedule it. The
application's own periodic checks are listed in the [configuration guide](../configuration.md).

## Clean up after a test

Empty and delete the test buckets, delete the service account (its keys go with it), and remove
the local file that held the secret. A bucket cannot be deleted until it is empty.
`yc iam access-key delete` takes the key's **resource id**, not the S3 access key id that starts
with `YC`.

## Sources

- [Yandex bucket policies](https://yandex.cloud/ru/docs/storage/concepts/policy) (read 2026-10-15)
- [Yandex bucket access settings](https://yandex.cloud/ru/docs/storage/operations/buckets/bucket-availability) (read 2026-10-15)
- [Yandex CORS](https://yandex.cloud/ru/docs/storage/operations/buckets/cors) (read 2026-10-15)
