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

The shipped avatar consumer is the one explicit public-read example. As of the
media-processing arc it runs the validated upload through the
[Media](../media/README.md) pipeline rather than storing the raw upload.

```http
POST /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

The implementation:

1. stores the uploaded **original privately** under a per-upload versioned key
   `avatars/{userId}/v-{version}/original`;
2. generates public WebP derivatives (`avatar-128/256/512.webp`) under the same
   `v-{version}/` prefix, with `cacheControl: public, max-age=31536000, immutable`
   (safe because keys are versioned);
3. stores the public URL of `avatar-256` in `User.avatarUrl` (unchanged
   compatibility field) and invalidates the user cache;
4. best-effort sweeps older versions and the legacy flat `avatars/{userId}`
   object after the new version is live.

The HTTP response shape is unchanged: `{ avatarUrl }`.

Delete is idempotent and **fail-closed** — it removes every object under
`avatars/{userId}/` plus the legacy flat object, and clears `avatarUrl` only
after storage cleanup succeeds:

```http
DELETE /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
```

Avatar uploads are rate-limited per IP (`5/min`) for the synchronous image
decode. See [Media](../media/README.md) for presets, limits, and security.

Concurrent avatar mutations for the same user are fenced by a monotonic
`User.avatarGeneration` (conditional update + generation-bounded sweep), so a
request that loses the race can neither overwrite nor delete the newer version.
A per-user Redis lock serializes the common case; under contention, a lost race,
or a Redis outage the upload/delete **fails closed** with a retriable
`503 AVATAR_LOCKED` rather than mutating storage unsafely. See
[Media → Concurrency](../media/README.md#concurrency).

## Private Files

For private user files, keep `visibility` omitted or set to `private`. Do not
return `getPublicUrl`. Use either:

- `getSignedDownloadUrl({ key })` for a time-limited S3 URL, or
- an authorized route that checks ownership/scope and then calls
  `StorageDownloadService.streamObject(key, res)`.

`StorageDownloadService` performs key validation, safe headers, not-found
mapping, and leak-free generic 500s, but it performs no authorization by design.

## Presigned Direct Uploads

`getSignedUploadUrl()` exists for advanced flows, but it bypasses server-side
byte validation because the browser uploads directly to the provider.

Use it only with a complete post-upload policy:

1. upload into a quarantine/private prefix;
2. verify size, type, and ownership after upload;
3. move/copy into the final key only after verification;
4. delete failed uploads;
5. never trust the client-supplied MIME type.

For most app features, use server-side validated upload first.
