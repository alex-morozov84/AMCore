# Self-hosted S3 servers

AMCore's own tests run against two self-hosted S3 servers. **They are test emulators, not a statement
that they are good production choices.** An emulator cannot prove ACLs, a CDN or a provider's
quirks. See [Testing](../testing.md).

## Verified emulators

Maintainers ran the wire tests (`test/storage-s3-wire.e2e-spec.ts`, `test/storage-public-check.e2e-spec.ts`)
against these servers, with their image digests pinned in the test files.

### SeaweedFS 4.48

Measured on 2026-10-14:

- `ACL: public-read` is **accepted and ignored**. An anonymous read still answered 403.
- A bucket policy with a **prefix** resource works. An anonymous read of the policy prefix answered
  200 and 403 everywhere else. Use `external` mode with a prefix policy.
- Presigned `GET` and `PUT` work when the SDK sends checksums only when required (AMCore does).
- `DeleteObjects` works.
- An unsigned read of a private bucket answered 403.

### Garage v2.4.1

Measured on 2026-10-14:

- `x-amz-acl` is accepted and ignored.
- `PutBucketPolicy` answers `501 NotImplemented`. You cannot publish a prefix with a policy.
- **Website mode serves the whole bucket publicly.** A private key answered 200 anonymously. Use it
  only on a separate public bucket, and never on a bucket that also holds private files.

## Provider-documented

Read 2026-10-14. The maintainers did not run these.

| Server             | What the documentation says                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Ceph RGW           | Enforces object ACLs and bucket policies, in an AWS-like way.                                                         |
| Versity S3 Gateway | Ignores object ACL headers. Supports bucket policies.                                                                 |
| LocalStack         | Emulates ACLs. The community edition does not enforce bucket policies. An account token is required since 2026-03-23. |

## Closed: MinIO

The community MinIO is source-only since October 2025 and in maintenance mode since December 2025.
Two secondary sources report the repository as archived in April 2026. AMCore does not test against
it and does not recommend it for new setups.

## Settings

Self-hosted servers usually need path-style addresses and an internal endpoint. Set the public
address of the public bucket in `STORAGE_PUBLIC_BASE_URL`, and see
[Configuration](../configuration.md). Run
[`storage:check`](../testing.md#check-a-real-provider-with-storagecheck) against your server.

## Sources

- [Garage S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
- [Versity: incompatibilities with AWS S3](https://github.com/versity/versitygw/wiki/Incompatibilities-With-AWS-S3)
- [LocalStack 2026.03 release](https://blog.localstack.cloud/localstack-for-aws-release-2026-03-0/)
- [MinIO status (Pinggy)](https://pinggy.io/blog/minio_archived_self_hosted_s3_alternatives/)
