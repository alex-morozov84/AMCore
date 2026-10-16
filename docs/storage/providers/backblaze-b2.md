# Backblaze B2

**Status: provider-documented** (Backblaze documentation read 2026-10-14, plus one older community
report). The maintainers have not run AMCore against B2. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=us-west-004
STORAGE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
STORAGE_PUBLIC_BASE_URL=https://f<NNN>.backblazeb2.com/file/<public-bucket>
```

Use your bucket's own region in `STORAGE_REGION` and `STORAGE_ENDPOINT`
(`s3.<region>.backblazeb2.com`).

## Publish the public files

B2 publishes a **whole bucket**:

1. Create a separate public bucket (the [two-bucket layout](../public-files.md#choose-the-layout)).
2. Set the bucket type to **public** (`allPublic`).
3. Set `STORAGE_PUBLIC_BASE_URL` to the bucket's public address.

Use the default `external` mode.

## Limits to know

- ACLs exist only at the bucket level (`private` or `public-read`). An object ACL must equal the
  bucket ACL. Do not use `acl` mode.
- An older community report says `x-amz-acl` was rejected on multipart uploads. Another reason to
  stay on `external`.
- With the AWS SDK's default checksum behavior, some S3-compatible providers reject the extra
  checksum headers. AMCore sets the SDK to send checksums only when required, so you do not need to
  change anything.
- Do not put private files into the bucket you publish.

## Sources

- [Backblaze S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Backblaze PutObjectAcl](https://backblaze.com/apidocs/s3-put-object-acl)
