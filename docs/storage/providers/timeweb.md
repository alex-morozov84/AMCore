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

Timeweb documents bucket ACL methods and bucket policies. Use a separate public bucket, publish
that bucket the way the console describes, and use the default `external` mode. If you prefer to
publish only `public/` in one bucket, use a bucket policy with the same shape as in the
[AWS page](aws.md#option-2-publish-only-public-with-a-bucket-policy).

Timeweb supports signature versions v2 and v4. AMCore uses v4.

## Sources

- [Timeweb bucket policies](https://timeweb.cloud/docs/s3-storage/supported-features/bucket-policies)
