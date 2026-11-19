# Testing storage

Storage is tested in four layers. Each layer proves something different, and no layer proves
everything. The last layer is yours to run, because only you have your provider account.

```text
1. Unit and contract tests     memory + local drivers, mocked S3 client      every pull request
2. S3 wire tests               real S3 servers in Docker (SeaweedFS, Garage)  every pull request
3. storage:check               YOUR real provider                            you run it, on demand
4. The public-delivery check   YOUR real provider, inside the running API     every hour, automatic
```

## What each layer proves

| Layer                 | Proves                                                                                                  | Cannot prove                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Unit and contract     | Every driver follows the same rules (visibility by key, copy never changes it, errors, metadata).       | Anything about a real network or provider.                                                      |
| S3 wire tests         | Real requests and responses: presigned URLs, multipart, delete many, a prefix policy, the public check. | ACLs, CDNs and provider quirks (see below).                                                     |
| `storage:check`       | The operations marked PASS worked with the configured driver and endpoints.                             | That it keeps working. Run it after each change.                                                |
| Public-delivery check | The public namespace stays readable and the private namespace stays closed.                             | Anything outside the two test files (see [Verify the setup](public-files.md#verify-the-setup)). |

### Why an emulator cannot prove ACLs

The two S3 servers in our tests accept an `x-amz-acl` header and **ignore** it. A test that sends
`public-read` and then reads the file anonymously gets 403 on both. So the tests prove that
AMCore handles that case safely, but they cannot prove that a given provider honors ACLs. Only a run
against the real provider can. For the same reason an emulator says nothing about a CDN in front of the
bucket. See [Self-hosted servers](providers/self-hosted.md).

## Check a real provider with `storage:check`

Run this after you set up a bucket, change a policy or a CDN, switch the delivery mode, or add a new
provider. It reads the same environment as the API and talks to the real provider. It needs no
database and no Redis.

```bash
pnpm --filter api storage:check      # from a checkout
node dist/cli/storage-check.js       # from the production image
```

From a checkout, the API environment must validate. The simplest way is to start from
`.env.example` and override the storage variables. Keep your trusted storage environment file outside the repository. It supplies
your `STORAGE_*` values and keys:

```bash
cd apps/api
(set -a; . ../../.env.example; . /path/to/my-storage.env; set +a; pnpm storage:check)
```

### What it does

It writes only under the reserved diagnostic folder (`STORAGE_PROBE_PREFIX`, default
`__amcore_probes__`) and its `public/` twin (`public/__amcore_probes__/`), removes what it created
(except the two canaries below) and never prints credentials, endpoints or provider messages. Exit
code 0 means every step passed or was skipped.

```text
storage:check driver=s3 mode=external buckets=one
PASS  private upload, download, metadata and delete
PASS  presigned download
PASS  presigned upload
PASS  multipart upload
PASS  copy and list
PASS  public delivery and private exposure
PASS  delete many and cleanup
```

| Step                                 | What a FAIL usually means                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| private upload, download, … delete   | Wrong keys, bucket, region or endpoint, or the account lacks permission. `AccessDenied` on every step: see [Troubleshooting](troubleshooting.md#accessdenied-on-every-call). |
| presigned download / upload          | The signing endpoint is wrong (a CDN), or the provider rejects checksums or the signature.                                                                                   |
| multipart upload                     | The provider rejects multipart or the account cannot write large objects.                                                                                                    |
| copy and list                        | Missing list or copy permission.                                                                                                                                             |
| public delivery and private exposure | The public location is not published, or **private files are exposed**. See [Public Files](public-files.md#verify-the-setup).                                                |
| delete many and cleanup              | The account cannot delete, or the provider rejects `DeleteObjects`.                                                                                                          |

A `SKIP` means the operation was not checked. The local driver skips signed URLs.
The delivery step also skips when no public base URL is configured.

The command sends requests from Node. To verify CORS, separately check a browser
upload from the deployed web origin.

### Things to know before you run it

- It makes real requests and writes one multipart file of a few megabytes, then deletes it. Your
  provider may bill for that. It is an **operator action**: never schedule it.
- It leaves two tiny canary files in place on purpose, so repeated runs are safe:
  `__amcore_probes__/private-canary` and `public/__amcore_probes__/public-canary`. A failed run may
  also leave a few objects of its own. A lifecycle rule on the probe prefix cleans those, and
  should apply only to diagnostic objects. Keep production buckets and user data intact.
- The result is a snapshot. The running API repeats the public part every hour
  ([the public-delivery check](public-files.md#verify-the-setup)).

## Record a result for your provider

If you ran `storage:check` on a provider that is not verified in the
[provider matrix](providers/README.md), send us the date, delivery mode, bucket layout and the
output (never keys or endpoints that identify your account). A maintainer marks the provider
**Verified** for the tested layout and mode, with the date. See the
[Yandex evidence and limits](providers/yandex.md#what-was-not-verified).

## Run the S3 wire tests

They need Docker. They start SeaweedFS and Garage with pinned image digests and test AMCore against
them. The storage specs are `test/storage-s3-wire.e2e-spec.ts`,
`test/storage-public-check.e2e-spec.ts` and `test/storage-probe.e2e-spec.ts` in `apps/api`. They run
with the rest of the API end-to-end suite:

```bash
pnpm --filter api test:e2e
```

See the [backend test guidance](../backend/architecture-and-conventions.md#tests) for how API
end-to-end tests are organized.
