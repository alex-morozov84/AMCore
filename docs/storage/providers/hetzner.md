# Hetzner Object Storage

**Status: provider-documented, partial** (Hetzner documentation read 2026-10-14). Some details are
unclear in the documentation. The maintainers have not run AMCore against Hetzner. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=<location>
STORAGE_ENDPOINT=https://<location>.your-objectstorage.com
STORAGE_PUBLIC_BASE_URL=<public address of the public bucket, if the console offers one>
```

Replace `<location>` with the location of your buckets.

## Publish the public files

We could not confirm from the documentation how to publish an object or a prefix:

- Object-level public access is **not confirmed**.
- Bucket policy support is **only partly documented**. The documentation says the policy element
  `NotAction` is not supported.

Test it before you rely on it. The fastest test is `storage:check` in the default `external` mode
with a **separate public bucket**, published the way the Hetzner console offers (if it offers one).
If the public check fails, or you cannot publish anything, use the `api` mode
([Public Files](../public-files.md#api)).

## Sources

- [Hetzner supported actions](https://docs.hetzner.com/storage/object-storage/supported-actions/)
