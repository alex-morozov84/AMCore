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

MWS has dropped object ACLs (the documentation calls them deprecated) and supports bucket policies
and IAM roles. Use the default `external` mode and publish with a **bucket policy** on a separate
public bucket. Do not use `acl` mode.

Publishing only `public/` in one bucket with a prefix policy is **not verified** on MWS. A policy
alone may not publish anything: on Yandex an AWS-shaped prefix policy published nothing until a
second setting was added (see [Yandex](yandex.md#2-publishing-a-prefix-needs-the-bucket-flag-and-the-policy)).
If you try it, run `storage:check`; if the public check fails, use a separate public bucket.

## Limits to know

- Presigned URLs live up to seven days.

## Sources

- [MWS: using the AWS CLI](https://mws.ru/docs/s3/util-awscli.html)
- [MWS blog post (Habr)](https://habr.com/ru/companies/mws/articles/979254/)
