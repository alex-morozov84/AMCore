# Timeweb Cloud

**Status: provider-documented** (Timeweb documentation read 2026-10-14). The maintainers have not
run AMCore against Timeweb. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru-1
STORAGE_ENDPOINT=https://s3.twcstorage.ru
```

Set `STORAGE_PUBLIC_BASE_URL` to the public address of the public bucket shown in the Timeweb
console (the bucket root, with no trailing slash).

## Publish the public files

Timeweb documents bucket ACL methods and bucket policies. Use a **separate public bucket**, publish
that whole bucket the way the console describes, and use the default `external` mode.

Publishing only `public/` in one bucket with a bucket policy is **not verified** on Timeweb. A
policy alone may not publish anything: on Yandex an AWS-shaped prefix policy published nothing until
a second setting was added (see [Yandex](yandex.md#2-publishing-a-prefix-needs-the-bucket-flag-and-the-policy)).
If you try it, run `storage:check`. If the public check fails, use a separate public bucket.

Timeweb supports signature versions v2 and v4. AMCore uses v4.

## Sources

- [Timeweb bucket policies](https://timeweb.cloud/docs/s3-storage/supported-features/bucket-policies)
