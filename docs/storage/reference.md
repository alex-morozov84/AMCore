# Storage API Reference

Application code should inject `StorageService`, not concrete providers.

```ts
constructor(private readonly storage: StorageService) {}
```

## Upload

```ts
await storage.upload({
  key: 'avatars/user-123',
  body: file.buffer,
  contentType: 'image/png',
  cacheControl: 'public, max-age=31536000',
  visibility: 'public-read',
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
| `visibility`         | `'private' \| 'public-read'?` | Defaults to `private`                        |

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

## URLs

```ts
const publicUrl = storage.getPublicUrl('avatars/user-123')
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

| Driver | Public URLs                                           | Signed URLs |
| ------ | ----------------------------------------------------- | ----------- |
| memory | no                                                    | no          |
| local  | yes, only when `STORAGE_LOCAL_PUBLIC_BASE_URL` is set | no          |
| s3     | yes                                                   | yes         |

If a driver does not support a capability, `StorageService` throws
`501 STORAGE_CAPABILITY_UNSUPPORTED`.

`getPublicUrl()` is only a real unauthenticated public/static/CDN URL. It must
not point at a guarded app download route.

## Copy And Move

```ts
await storage.copy({ source: 'a.txt', destination: 'b.txt' })
await storage.move({ source: 'b.txt', destination: 'archive/b.txt' })
```

Moving a key onto itself is a no-op.

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
