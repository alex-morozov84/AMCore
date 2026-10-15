# AWS S3

**Status: provider-documented** (AWS documentation read 2026-10-14). The maintainers have not run
AMCore against AWS. Run [`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) on
your account.

## Settings

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<private-bucket>
STORAGE_PUBLIC_BUCKET=<public-bucket>
STORAGE_REGION=us-east-1
STORAGE_PUBLIC_BASE_URL=https://<distribution>.cloudfront.net
```

No `STORAGE_ENDPOINT` is needed for AWS: the SDK picks the regional endpoint.

## What AWS does by default

- New buckets use "Bucket owner enforced" object ownership. **ACLs are disabled.** A request that
  sends an ACL fails with `AccessControlListNotSupported` (HTTP 400). Do not use
  `STORAGE_PUBLIC_DELIVERY=acl` on a default bucket.
- **Block Public Access** is on. It rejects public policies and public ACLs until you relax it.
- Copying an object does not copy its ACL.

So use the default `external` mode and publish the location one of two ways.

## Option 1: CloudFront in front of a private public-bucket (recommended)

Keep Block Public Access on. Put a CloudFront distribution in front of the public bucket with
**origin access control**, so only the distribution can read it. Set `STORAGE_PUBLIC_BASE_URL` to the
distribution's domain (or your own domain on it). The bucket stays private to the internet.

## Option 2: publish only `public/` with a bucket policy

Turn off the "policy" settings of Block Public Access for that one bucket and attach:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForPublicPrefix",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/public/*"
    }
  ]
}
```

Then `STORAGE_PUBLIC_BASE_URL=https://<bucket>.s3.<region>.amazonaws.com`. Never allow `GetObject` on
`arn:aws:s3:::<bucket>/*` in a bucket that also holds private files.

Unlike [Yandex](yandex.md), AWS needs no extra "public" flag beyond relaxing Block Public Access.
This comes from the AWS documentation and was not run by us.

## Limits to know

- A presigned `PUT` signs only the host. The content type and size are not enforced. Validate after
  upload ([Uploads](../uploads.md#presigned-direct-uploads)).
- Presigned URLs must use the S3 endpoint, not CloudFront.

## Sources

- [Object ownership](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html)
- [Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [CloudFront origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
