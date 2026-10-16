# Cloudflare R2

**Status: provider-documented** (Cloudflare documentation read 2026-10-14, with two community reports
on error behavior). The maintainers have not run AMCore against R2. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_PUBLIC_BASE_URL=https://assets.example.com
```

## Publish the public files

R2 has **no S3 bucket policy** and **no object ACLs**. It publishes a **whole bucket**:

1. Create a separate public bucket (the [two-bucket layout](../public-files.md#choose-the-layout)).
2. Attach a **custom domain** to it. That gives you caching and WAF rules.
3. Set `STORAGE_PUBLIC_BASE_URL` to the custom domain.

Use the default `external` mode. Do not use `acl`: R2 does not support `x-amz-acl`. Reports show it
answers `501 NotImplemented` for any value other than `private`.

The `r2.dev` public address is rate-limited and meant for development only. Do not use it in
production.

## Limits to know

- Presigned URLs work only on the `r2.cloudflarestorage.com` endpoint, never on a custom domain.
  Keep the CDN or custom domain only in `STORAGE_PUBLIC_BASE_URL`.
- Do not put private files into the bucket you publish.

## Sources

- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
