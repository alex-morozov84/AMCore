# Storage Configuration

Storage is configured entirely through environment variables and validated at
startup.

## Driver Selection

| Environment     | Default driver | Why                                                            |
| --------------- | -------------- | -------------------------------------------------------------- |
| `production`    | `s3`           | Fails fast unless a real bucket and credentials are configured |
| `test`          | `memory`       | Fast deterministic unit tests                                  |
| everything else | `local`        | No cloud dependency during development                         |

Override with:

```env
STORAGE_DRIVER=s3 # s3 | local | memory
```

## S3-Compatible Storage

Required when `STORAGE_DRIVER=s3`:

```env
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

Optional but common:

```env
STORAGE_ENDPOINT=
STORAGE_PUBLIC_ENDPOINT=
STORAGE_FORCE_PATH_STYLE=false
STORAGE_SIGNED_URL_DEFAULT_TTL=3600
STORAGE_SIGNED_URL_MAX_TTL=604800
```

`STORAGE_ENDPOINT` is the SDK endpoint. It may be internal or private.
`STORAGE_PUBLIC_ENDPOINT` is the browser-facing public/CDN/S3 API endpoint used
for public URLs and presigning. If it is set, `getPublicUrl(key)` returns:

```text
{STORAGE_PUBLIC_ENDPOINT}/{key}
```

No bucket is synthesized onto a configured public endpoint.

## Provider Examples

### AWS S3

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ENDPOINT=
STORAGE_PUBLIC_ENDPOINT=
STORAGE_FORCE_PATH_STYLE=false
```

Public URL shape without `STORAGE_PUBLIC_ENDPOINT`:

```text
https://{bucket}.s3.{region}.amazonaws.com/{key}
```

### Cloudflare R2

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
STORAGE_FORCE_PATH_STYLE=false
```

### DigitalOcean Spaces

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=nyc3
STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

### Yandex Object Storage

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=ru-central1
STORAGE_ENDPOINT=https://storage.yandexcloud.net
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

### Backblaze B2

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-west-004
STORAGE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

## Local Driver

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
STORAGE_LOCAL_PUBLIC_BASE_URL=http://localhost:3001/static
```

The local driver stores bytes under:

```text
{STORAGE_LOCAL_ROOT}/objects/{key}
```

and metadata sidecars under:

```text
{STORAGE_LOCAL_ROOT}/meta/{key}.json
```

`STORAGE_LOCAL_PUBLIC_BASE_URL` must point at a static mount of
`{STORAGE_LOCAL_ROOT}/objects`, not at `{STORAGE_LOCAL_ROOT}`. Mounting the root
would expose metadata sidecars.

## Health

Storage readiness is opt-in:

```env
STORAGE_HEALTH_ENABLED=false
STORAGE_HEALTH_PROBE_KEY=__storage_health_check__
```

If a production bucket uses prefix-scoped credentials, set
`STORAGE_HEALTH_PROBE_KEY` inside the allowed prefix, for example:

```env
STORAGE_HEALTH_PROBE_KEY=avatars/.health
```

## Limits

```env
STORAGE_MAX_FILE_SIZE=52428800
STORAGE_SIGNED_URL_MAX_TTL=604800
```

`STORAGE_SIGNED_URL_MAX_TTL` cannot exceed 604800 seconds because SigV4
presigned URLs have a seven-day hard limit.
