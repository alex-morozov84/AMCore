# MWS Object Storage

**Status: provider-documented** (MWS documentation and one MWS blog post, read 2026-10-14). The
maintainers have not run AMCore against MWS. Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=ru-central1
STORAGE_ENDPOINT=https://storage.mwsapis.ru
```

The region `ru-central1` comes from a provider blog post, not from the reference documentation.
Confirm it in your account. Set `STORAGE_PUBLIC_BASE_URL` to the public address of the public
bucket.

## Publish the public files

The retained provider material describes object ACLs as deprecated and describes
bucket policies and IAM roles. Confirm current support in your account. Use the default `external` mode and publish with a **bucket policy** on a separate
public bucket. Do not use `acl` mode.

The single-bucket prefix layout remains unverified. Use the separate public
bucket above unless you verify the narrower policy in a test account.

## Limits to know

- Presigned URLs live up to seven days.

## Sources

- [MWS blog post (Habr)](https://habr.com/ru/companies/mws/articles/979254/)
