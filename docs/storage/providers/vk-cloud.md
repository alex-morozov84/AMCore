# VK Cloud

**Status: provider-documented** (VK Cloud documentation read 2026-10-14). The maintainers have not
run AMCore against VK Cloud. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru-msk
STORAGE_ENDPOINT=https://hb.ru-msk.vkcloud-storage.ru
STORAGE_PUBLIC_BASE_URL=https://<public-bucket>.hb.ru-msk.vkcloud-storage.ru
```

The signing region (SigV4) is `ru-msk`. VK Cloud uses virtual-hosted addresses.

## Publish the public files

VK Cloud supports canned ACLs and `x-amz-grant-*` headers, where `AllUsers` means anonymous. It does
**not** support bucket or object policies, Public Access Block, tagging or versioning.

So publish with a **bucket ACL**:

1. Create a separate public bucket (the [two-bucket layout](../public-files.md#choose-the-layout)).
2. Set the **bucket** ACL to `public-read` once, in the console or with an S3 client.
3. Use the default `external` mode. The application then sends no ACL.

Because VK Cloud has no policies, you cannot publish only a prefix. Do not put private files into
the bucket you publish.

## Limits to know

- Presigned URLs: signature versions v2 and v4, maximum seven days.

## Sources

- [VK Cloud S3 ACL](https://cloud.vk.ru/docs/en/storage/s3/instructions/access-management/s3-acl)
