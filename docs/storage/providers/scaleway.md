# Scaleway Object Storage

**Status: provider-documented** (Scaleway documentation read 2026-10-14). The maintainers have not
run AMCore against Scaleway. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=<region>
STORAGE_ENDPOINT=https://s3.<region>.scw.cloud
STORAGE_PUBLIC_BASE_URL=https://<public-bucket>.s3.<region>.scw.cloud
```

Scaleway prefers virtual-hosted addresses (`<bucket>.s3.<region>.scw.cloud`).

## Publish the public files

Scaleway documents object visibility, bucket visibility and bucket policies. Pick one:

- default `external` mode with a separate public bucket (make the bucket public), or
- default `external` mode with a bucket policy that publishes `public/*`, or
- `acl` mode (the application sends `public-read`), if the object visibility setting matches the
  S3 `public-read` ACL in your account.

Run `storage:check` to see which one your account accepts.

## Sources

- [Scaleway Object Storage concepts](https://www.scaleway.com/en/docs/object-storage/concepts/)
