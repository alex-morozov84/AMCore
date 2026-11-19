# Hetzner Object Storage

**Status: provider-documented, partial** (see sources below). The maintainers have not run AMCore against Hetzner. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_PUBLIC_DELIVERY=external
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=<location>
STORAGE_ENDPOINT=https://<location>.your-objectstorage.com
STORAGE_PUBLIC_BASE_URL=https://<public-bucket>.<location>.your-objectstorage.com
```

Replace `<location>` with the location of your buckets.

## Publish the public files

Hetzner documents public bucket visibility. Use a separate bucket for public files
and keep the private bucket private. Use `external` mode and set the base URL to
the public bucket root. Verify the configured account with `storage:check`.
Prefix publication and AMCore object ACL mode remain unverified here.

## Sources

- [Hetzner supported actions](https://docs.hetzner.com/storage/object-storage/supported-actions/)
- [Hetzner bucket visibility](https://docs.hetzner.com/storage/object-storage/faq/buckets-objects/)
