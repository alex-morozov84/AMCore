# Beget

**Status: provider-documented** (Beget knowledge base read 2026-10-14). The maintainers have not run
AMCore against Beget. Run [`storage:check`](../testing.md#check-a-real-provider-with-storagecheck)
on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru1
STORAGE_ENDPOINT=https://s3.ru1.storage.beget.cloud
```

Set `STORAGE_PUBLIC_BASE_URL` to the public address of the public bucket from the Beget panel.

## Publish the public files

Beget documents a **public bucket policy**. Use a separate public bucket and the default `external`
mode. We found no statement about object ACLs, so do not use `acl` mode.

## Sources

- [Beget: S3 object storage](https://beget.com/ru/kb/manual/obektnoe-hranilishche-s3-v-beget)
