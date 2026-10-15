# Media Configuration

All media settings come from `MEDIA_*` environment variables (already present in
[`.env.example`](../../.env.example)). They are validated at startup in
[`media.env.ts`](../../apps/api/src/env/schema/media.env.ts), with cross-field
caps enforced in
[`resource-rules.ts`](../../apps/api/src/env/schema/refinements/resource-rules.ts).

## Environment Variables

| Variable                         | Default                               | Purpose                                                             |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `MEDIA_MAX_SOURCE_BYTES`         | `5242880` (5 MB)                      | Reject a source object larger than this **before** download.        |
| `MEDIA_MAX_WIDTH`                | `8000`                                | Reject sources wider than this (px).                                |
| `MEDIA_MAX_HEIGHT`               | `8000`                                | Reject sources taller than this (px).                               |
| `MEDIA_MAX_PIXELS`               | `40000000` (40 MP)                    | Global decoded-pixel cap (`width × height`).                        |
| `MEDIA_SHARP_LIMIT_INPUT_PIXELS` | `40000000`                            | Hard libvips decode guard (defense-in-depth). Must be ≤ MAX_PIXELS. |
| `MEDIA_AVATAR_MAX_PIXELS`        | `8000000` (8 MP)                      | Tighter cap for the synchronous avatar path. Must be ≤ MAX_PIXELS.  |
| `MEDIA_AVATAR_CACHE_CONTROL`     | `public, max-age=31536000, immutable` | Cache-control written on public avatar derivatives.                 |

Startup validation enforces `MEDIA_AVATAR_MAX_PIXELS ≤ MEDIA_MAX_PIXELS` and
`MEDIA_SHARP_LIMIT_INPUT_PIXELS ≤ MEDIA_MAX_PIXELS`.

Immutable caching is safe because avatar derivative keys are **versioned**
per upload (`public/avatars/{userId}/v-{version}/…`); a re-upload publishes a new URL.

## Presets

Presets are server-owned and bounded — clients never pass width/quality. The
only shipped preset is `avatar`:

| Variant      | Size (cover) | Format | Quality |
| ------------ | ------------ | ------ | ------- |
| `avatar-128` | 128 × 128    | WebP   | 82      |
| `avatar-256` | 256 × 256    | WebP   | 82      |
| `avatar-512` | 512 × 512    | WebP   | 82      |

`avatar-256` is the primary derivative whose object key is stored in
`User.avatarKey`; the API computes `avatarUrl` from it on every response. Originals are stored privately (`…/v-{version}/original`) for
possible future re-derivation; only derivatives live in the public namespace.

## Native Dependency

Image processing uses `sharp` (libvips). The API Docker image is built on
`node:24-slim` (glibc) so sharp's prebuilt binary loads cleanly, and a CI smoke
test encodes a WebP inside the built production image to verify native loading.
Forks on Alpine must configure the musl sharp package and keep an equivalent
production-image smoke check.

## Next.js Consumption

The backend returns concrete public derivative URLs (the computed `avatarUrl`). The web starter
shows them with `UserAvatar` (`entities/user`), which renders `next/image` with `unoptimized`:
the derivatives are already sized WebP files, so the Next.js image optimizer (a server-side fetch
of a remote URL) is not used and no `images.remotePatterns` list is needed.

The browser still has to be allowed to load the image. Set `WEB_PUBLIC_FILES_ORIGIN` on the web
service to the origin of `STORAGE_PUBLIC_BASE_URL` (a CDN or public bucket host, or the API origin
when the API serves public files). It is added to the CSP `img-src` directive and nowhere else.
Only an exact `https` origin, or a loopback `http` origin for local development, is accepted;
anything else is ignored and leaves images limited to the web origin. See
[browser security and CSP](../frontend/browser-security-and-csp.md).

- Use the backend-provided URL directly; do not have the backend know Next.js
  internals.
- Because derivative URLs are immutable and versioned, clients and CDNs may cache
  them aggressively — a new upload yields a new URL.
- If you later expose multiple variants with width/height, clients can build a
  `srcSet`; the backend stays the source of truth for which variants exist.

This covers the **display** side. For the upload/delete request itself (the
`useUploadAvatar`/`useDeleteAvatar` hooks and the BFF's multipart pass-through),
see [Frontend API consumption](../frontend/api-consumption.md#media--avatar-uploaddelete).
