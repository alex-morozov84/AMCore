# Cloud.ru

**Status: provider-documented** (Cloud.ru documentation read 2026-10-14). The maintainers have not
run AMCore against Cloud.ru. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru-central-1
STORAGE_ENDPOINT=https://s3.cloud.ru
STORAGE_ACCESS_KEY_ID=<tenant-id>:<key-id>
STORAGE_SECRET_ACCESS_KEY=<secret>
STORAGE_PUBLIC_BASE_URL=https://<public-bucket>.s3.cloud.ru
```

The access key id has the form `<tenant_id>:<key_id>`. Do not put only the key id.

## Publish the public files

Cloud.ru publishes a **whole bucket**:

1. Create a separate public bucket (the [two-bucket layout](../public-files.md#choose-the-layout)).
2. Make it public. Cloud.ru documents bucket policies, and a bucket ACL (`AllUsers`) after you
   change the bucket ownership setting.
3. Use the default `external` mode.

The public address is either `https://<bucket>.s3.cloud.ru` or
`https://global.s3.cloud.ru/<global_name>/<key>`. Use the first form for
`STORAGE_PUBLIC_BASE_URL`, because AMCore builds addresses as `<base>/<key>`.

Do not put private files into the bucket you publish.

## Sources

- [Cloud.ru: getting started with the API](https://cloud.ru/docs/s3e/ug/topics/api__getting-started)
- [Cloud.ru: public access for a bucket](https://cloud.ru/docs/s3e/ug/topics/guides__public-access-for-bucket.html)
