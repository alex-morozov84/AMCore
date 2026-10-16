# Selectel

**Status: provider-documented** (Selectel documentation read 2026-10-14). The maintainers have not
run AMCore against Selectel. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru-1
STORAGE_ENDPOINT=https://s3.ru-1.storage.selcloud.ru
STORAGE_PUBLIC_BASE_URL=https://<bucket-uuid>.selstorage.ru
```

The region equals the pool name (for example `ru-1`). Selectel documents both path-style and
virtual-hosted addresses; with virtual-hosted addresses it documents a default limit of 100 buckets.

## Publish the public files

Selectel has **no object or bucket ACLs** (the documentation lists only "get ACL"). It does support
bucket policies. The important rule is about domains:

- The **S3 API domain** (`s3.<pool>.storage.selcloud.ru`) accepts only **authorized** requests.
  Anonymous reads never work there.
- Create a **public bucket** (a bucket type). It gets a public domain
  `<bucket-uuid>.selstorage.ru`, or you attach your own domain.

So use a separate public bucket, the default `external` mode, and set `STORAGE_PUBLIC_BASE_URL` to
the public domain. Do not use `acl` mode.

## Open question

The documentation states a "15 minute" signature lifetime. We have not verified what that means for
presigned URLs (for example whether a longer `STORAGE_SIGNED_URL_MAX_TTL` is truncated). Test a
presigned download that lives longer than 15 minutes before you rely on one.

## Sources

- [Selectel Object Storage S3 API](https://docs.selectel.ru/en/api/object-storage-s3/)
- [Selectel: configure storage](https://docs.selectel.ru/en/s3/manage/configure-storage-update/)
