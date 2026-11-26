# Uploads

AMCore's safe default is server-side validated upload: bytes reach the API first,
the API validates them, then `StorageService` writes to the active provider.

## Server-Side Validation

Use `FileValidationPipe` with a preset:

```ts
@Post('me/avatar')
@Auth(AuthType.Bearer)
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 6 * 1024 * 1024 } }))
async uploadAvatar(
  @CurrentUser('sub') userId: string,
  @UploadedFile(new FileValidationPipe(AVATAR_VALIDATION)) file: AvatarUploadFile
) {
  // validated bytes only
}
```

The pipe:

- uses `buffer.length` as the authoritative size;
- uses `file-type` magic bytes, never client `Content-Type`;
- returns `413 FILE_TOO_LARGE` for oversized files;
- returns `400` for unknown, spoofed, disallowed, or SVG image files.

## Presets

| Preset                | Max size | MIME types           | Serving policy |
| --------------------- | -------- | -------------------- | -------------- |
| `AVATAR_VALIDATION`   | 2 MB     | JPEG, PNG, WebP      | inline         |
| `IMAGE_VALIDATION`    | 5 MB     | JPEG, PNG, WebP, GIF | inline         |
| `DOCUMENT_VALIDATION` | 10 MB    | PDF, JPEG, PNG       | attachment     |

SVG is intentionally excluded from every image preset. Inline SVG is a stored
XSS risk, and magic-byte detection does not provide the same confidence as for
raster images.

## Avatar Flow

The avatar endpoint sends validated images through the [media pipeline](../media/README.md).
It keeps the original private and publishes generated WebP derivatives.

```http
POST /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

The implementation:

1. stores the uploaded **original privately** under a per-upload versioned key
   `avatars/{userId}/v-{version}/original`;
2. generates public WebP derivatives (`avatar-128/256/512.webp`) under the public
   namespace, `public/avatars/{userId}/v-{version}/`,
   with `cacheControl: public, max-age=31536000, immutable`
   (safe because keys are versioned);
3. stores the object key of `avatar-256` in `User.avatarKey` (the API computes
   `avatarUrl` from it on every response); the next request reads the new key from the database;
4. best-effort sweeps older versions and the legacy flat `avatars/{userId}`
   object after the new version is live.

The HTTP response shape is unchanged: `{ avatarUrl }`. The URL is derived from the stored key, so it changes with `STORAGE_PUBLIC_BASE_URL` and must not be persisted by clients.

Delete is idempotent and **fail-closed** — it sweeps older versions under
`avatars/{userId}/` and `public/avatars/{userId}/` plus the legacy flat object, and clears `avatarKey` only
after storage cleanup succeeds. A failure can leave a partial cleanup. See the
[avatar lifecycle](../media/README.md#avatar-flow-the-shipped-example):

```http
DELETE /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
```

Avatar uploads use the expensive-action policy (5/min sustained, burst 5 per
route and tracker). See [Media](../media/README.md) for presets, limits, and security.

Concurrent avatar mutations for the same user are fenced by a monotonic
`User.avatarGeneration` (conditional update + generation-bounded sweep), so a
request that loses the race can neither overwrite nor delete the newer version.
A per-user Redis lock serializes the common case; under contention, a lost race,
or a Redis outage the upload/delete **fails closed** with a retriable
`503 AVATAR_LOCKED` rather than mutating storage unsafely. See
[Media → Concurrency](../media/README.md#concurrency).

## Private Files

For private user files, use a key outside `public/`. Do not
return `getPublicUrl`. Use either:

- `getSignedDownloadUrl({ key })` for a time-limited S3 URL after the same ownership
  and scope checks, or
- an authorized route that checks ownership/scope and then calls
  `StorageDownloadService.streamObject(key, res)`.

`StorageDownloadService` performs key validation, safe headers, not-found
mapping, and leak-free generic 500s, but it performs no authorization by design.

## Presigned Direct Uploads

`getSignedUploadUrl()` exists for advanced flows, but it bypasses server-side
byte validation because the browser uploads directly to the provider.

The shipped avatar flow uses server-side multipart. A direct-upload feature
owns its upload grant, object ownership, expiry, finalization and cleanup policy.
Completing validation does not revoke an outstanding URL.

Use a complete post-upload policy:

1. upload into a quarantine/private prefix;
2. verify size, decoded type, and ownership after upload. A signed PUT does
   not enforce these properties. Use a stable snapshot of the verified bytes
   for processing and promotion, since an outstanding upload URL may replace
   the quarantine object;
3. use the verified bytes for final storage. For a public output, generate the
   allowed derivative and upload it under `public/`. Storage copy and move
   reject crossing the private/public boundary;
4. clean up failed or abandoned uploads, including objects uploaded again
   before the grant expires;
5. never trust the client-supplied MIME type.

For most app features, use server-side validated upload first.

## Public forms with attachments

The avatar route requires sign-in, limits upload size and frequency, and detects
the format from bytes. It checks decoded image dimensions and publishes only a
generated WebP. The original stays private. These checks provide no malware verdict. See [Media security](../media/security.md).

The AI attachment route also requires sign-in and limits upload size and
frequency. It checks the conversation owner and state, detects the format from
bytes, and applies limits for images and PDFs. It stores the original privately
and serves it as an attachment after an access check. These format and size
checks provide no malware verdict.

1. Cap the request at the proxy when available. Limit file size, file count,
   field size, field count, and total multipart parts before buffering.
2. Limit upload frequency and stored bytes. Use server-generated keys and expire
   abandoned uploads. Allow only the formats the form needs. Keep archives out
   unless the product can bound the work and output of extraction.
3. Check file bytes on the server. For public images, decode within pixel limits
   and publish a new raster image. For a PDF that staff will open, keep it
   private while a scanner checks it. Block downloads, previews, and downstream
   processing while the result is pending, failed, or denied.
4. After the scanner allows the file, check the recipient's current rights.
   Serve the approved bytes as an attachment. Bind the verdict to an immutable
   version or verify the digest of the exact bytes sent. Give each resubmission
   its own version and verdict.

Run the [PDF quarantine example](../../apps/api/src/infrastructure/storage/pdf-quarantine.example.spec.ts)
from the repository root after installing dependencies.

```sh
pnpm --filter shared build
pnpm --filter api test --runInBand --runTestsByPath src/infrastructure/storage/pdf-quarantine.example.spec.ts
```

The test shows an invalid upload rejected, a pending PDF held privately, and an
approved PDF released only to the authorized recipient. It uses a test scanner
result to exercise access rules. For a public form, connect a real scanner and
define when to retry failed scans and delete rejected or expired uploads.
