# DigitalOcean Spaces

**Status: provider-documented** (DigitalOcean documentation read 2026-10-14). The maintainers have
not run AMCore against Spaces. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-space>
STORAGE_PUBLIC_BUCKET=<public-space>
STORAGE_REGION=nyc3
STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
STORAGE_PUBLIC_BASE_URL=https://<public-space>.nyc3.cdn.digitaloceanspaces.com
```

Use your Space's own region (`<region>.digitaloceanspaces.com`).

## Publish the public files

Spaces supports the canned ACLs `private` and `public-read`, and bucket policies. You can:

- use the default `external` mode with a separate public Space, or
- use `acl` mode (the application sends `public-read` on `public/` objects). Spaces documents
  `public-read` as supported.

Spaces documents a CDN address (`…cdn.digitaloceanspaces.com`). Put it only in
`STORAGE_PUBLIC_BASE_URL`, never in the endpoint used for signing.

## Limits to know

- Presigned URLs work with the S3 endpoint. Do not point the signing endpoint at the CDN.
- Spaces documents both signature versions v2 and v4. AMCore uses v4.

## Sources

- [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/)
