# Storage API Reference

Application code should inject `StorageService`, not concrete providers.

```ts
constructor(private readonly storage: StorageService) {}
```

## Upload

```ts
await storage.upload({
  key: 'public/avatars/user-123/v-1-abc/avatar-256.webp',
  body: file.buffer,
  contentType: 'image/png',
  cacheControl: 'public, max-age=31536000',
})
```

Input:

| Field                | Type                          | Notes                                        |
| -------------------- | ----------------------------- | -------------------------------------------- |
| `key`                | `string`                      | Object key; normalized and traversal-guarded |
| `body`               | `Buffer \| Readable`          | Bytes to store                               |
| `contentType`        | `string?`                     | Metadata only; validate bytes before calling |
| `contentDisposition` | `string?`                     | Metadata / response behavior                 |
| `cacheControl`       | `string?`                     | Provider cache metadata                      |
| `metadata`           | `Record<string,string>?`      | Provider metadata                            |
| `visibility`         | `'private' \| 'public-read'?` | Optional assertion; the key decides (below)  |

Result:

```ts
{
  key: string
  size: number
  etag?: string
  contentType?: string
}
```

`UploadResult` deliberately has no guaranteed URL.

### Visibility follows the key

A key under the reserved `public/` namespace is public; every other key is private.
`visibility` is an optional assertion: omit it, or pass the value the key implies.
A contradiction (`public-read` for a key outside `public/`, `private` for one under
it) throws `InvalidObjectKeyError`. See [Public Files](public-files.md).

Treat `etag` as a provider-specific opaque object version. New local uploads
use a SHA-256 content digest; existing stored ETags remain valid when reading
or copying older objects. S3-compatible providers supply their own ETags.

## Read

```ts
const bytes = await storage.download('docs/a.pdf')
const stream = await storage.downloadStream('docs/a.pdf')
const metadata = await storage.getMetadata('docs/a.pdf')
```

Missing objects throw `StorageObjectNotFoundError`.

## Delete

```ts
await storage.delete('docs/a.pdf')
await storage.deleteMany(['docs/a.pdf', 'docs/b.pdf'])
```

`deleteMany()` returns `Promise<void>`. S3 batch partial failures throw
`StorageDeleteManyException` with failures shaped as:

```ts
{ key: string, code?: string }
```

The exception does not expose provider secrets or raw credential material.

## Exists

```ts
const present = await storage.exists('docs/a.pdf')
```

`exists()` returns `false` only for a genuine missing object. Infrastructure
faults, permission errors, and broken local roots propagate.

## List

```ts
const page = await storage.list({
  prefix: 'avatars/',
  maxKeys: 100,
  continuationToken: previous.nextToken,
})
```

Result:

```ts
{
  files: Array<{ key: string; size: number; lastModified?: Date; etag?: string }>
  nextToken?: string
  isTruncated: boolean
}
```

Prefix values may be empty or end in `/`. Object keys still go through the
stricter key guard on read/write operations.

An empty prefix (or a leading part of `public/`, such as `pu`) spans the public and
the private namespace. With **one** bucket it lists both. With **separate** public
and private buckets (`STORAGE_PUBLIC_BUCKET`) it is ambiguous and the S3 driver
throws `InvalidObjectKeyError`; list `public/…` and the private prefix separately.

## URLs

```ts
// The avatar derivative lives under the public/ namespace.
const publicUrl = storage.getPublicUrl('public/avatars/user-123/v-1-abc/avatar-256.webp')
const signed = await storage.getSignedDownloadUrl({
  key: 'private/report.pdf',
  expiresIn: 900,
  contentDisposition: 'attachment; filename="report.pdf"',
})
const uploadUrl = await storage.getSignedUploadUrl({
  key: 'quarantine/user-123/upload.bin',
  contentType: 'application/octet-stream',
})
```

Capability support:

| Driver | Public URLs                       | Signed URLs |
| ------ | --------------------------------- | ----------- |
| memory | no                                | no          |
| local  | yes, through the API public route | no          |
| s3     | yes                               | yes         |

If a driver does not support a capability, `StorageService` throws
`501 STORAGE_CAPABILITY_UNSUPPORTED`.

`getPublicUrl()` accepts only keys under `public/` (a private key throws
`InvalidObjectKeyError`) and builds the address from `STORAGE_PUBLIC_BASE_URL`
without contacting the provider: `{base}/{key}` for S3 in `external` and `acl` mode,
`{base}?key={key}` for the API public route (the local driver and S3 in `api` mode). Whether
the provider actually serves the file depends on how you published the namespace. It must not
point at a guarded app download route.

## Copy And Move

```ts
await storage.copy({ source: 'a.txt', destination: 'b.txt' })
await storage.move({ source: 'b.txt', destination: 'archive/b.txt' })
```

Moving a key onto itself is a no-op. A copy or move never crosses the `public/`
boundary in either direction (`InvalidObjectKeyError`); upload the validated bytes
again under the target key instead.

## Object Key Rules

Object keys are normalized by `normalizeObjectKey()`:

- trims surrounding whitespace;
- collapses duplicate slashes;
- rejects empty keys;
- rejects leading slash;
- rejects backslash;
- rejects NUL/control characters;
- rejects `.` and `..` path segments;
- rejects keys over the configured byte cap.

Examples:

```ts
normalizeObjectKey('avatars//u1.png') // avatars/u1.png
normalizeObjectKey('../secret') // throws InvalidObjectKeyError
```
