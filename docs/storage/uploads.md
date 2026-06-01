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

The shipped avatar consumer is the one explicit public-read example:

```http
POST /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

The implementation stores the object at:

```text
avatars/{userId}
```

with:

```ts
{
  visibility: 'public-read',
  cacheControl: 'public, max-age=31536000'
}
```

It then stores `storage.getPublicUrl(key)` in `User.avatarUrl` and invalidates
the user cache.

Delete is idempotent:

```http
DELETE /api/v1/auth/me/avatar
Authorization: Bearer <accessToken>
```

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
