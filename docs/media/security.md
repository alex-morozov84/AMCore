# Media Security

Image processing turns untrusted bytes into decoded pixels — a classic source of
memory-exhaustion, decompression bombs, and metadata leaks. The media layer is
conservative by default.

## Accepted Input

The avatar preset accepts only **JPEG, PNG, WebP** (still images). Validation is
two-layered:

1. **Transport** — `FileValidationPipe` checks magic bytes (not the client
   `Content-Type`), enforces the 2 MB avatar limit, and rejects SVG.
2. **Decode** — the processor decodes via `sharp`, re-checks the real format,
   and rejects anything outside the decodable set or over the configured limits.

Rejected / deferred:

| Input             | Status            | Why                                                          |
| ----------------- | ----------------- | ------------------------------------------------------------ |
| SVG               | rejected          | Stored-XSS risk; magic-byte detection is unreliable for SVG. |
| Animated GIF/WebP | rejected (avatar) | Animation policy + resource cost need an explicit decision.  |
| AVIF input        | deferred          | Decode cost/support should be verified per deployment.       |
| HEIC/HEIF         | deferred          | Uneven browser/codec support; heavier native packaging.      |
| Arbitrary URLs    | rejected          | Only objects already owned by this backend are processed.    |

There is **no** generic public transform endpoint. Clients cannot request
arbitrary dimensions/quality; only named, server-defined preset variants exist.

## Limits

- **Source bytes** are capped (`MEDIA_MAX_SOURCE_BYTES`) by reading object
  metadata **before** downloading into memory — an oversized stored object is
  rejected without being pulled in full.
- **Decoded dimensions/pixels** are enforced after `sharp` reads metadata
  (`MEDIA_MAX_WIDTH/HEIGHT/PIXELS`), with a tighter per-preset cap for avatars
  (`MEDIA_AVATAR_MAX_PIXELS`, 8 MP).
- **`limitInputPixels`** is passed to every `sharp` decode as a hard libvips
  guard (defense-in-depth, not the only check).
- Zero/unknown dimensions and undecodable bytes are rejected.

## EXIF & Metadata

- Derivatives are **auto-oriented** from EXIF orientation, then encoded with
  **all metadata stripped** (sharp's default — `keepMetadata()` is never called).
- EXIF/GPS/ICC from the original never reaches a public derivative, so location
  and device metadata are not exposed.
- Orientation is baked into pixels before resize, preventing rotated-display bugs.

## Originals vs Derivatives

- Originals are stored **private** (`avatars/{userId}/v-{version}/original`).
- Only generated raster derivatives are written `public-read`.
- A public derivative is always a freshly encoded output, never the user-supplied
  original bytes.

## Resource Isolation

Avatar processing runs **synchronously** in the API process. Mitigations:

- strict byte/dimension/pixel caps (above);
- a per-route throttle on `POST /auth/me/avatar` (5/min/IP) for the heavy decode;
- no arbitrary transform parameters; no remote URL fetching; no SVG;
- no ImageMagick delegates / shell execution.

High-volume forks should move processing to a separate worker/process with CPU
and memory limits. That is a deployment pattern, not required for the baseline.

## Deferred Scope

The following are intentionally **not** implemented in this arc:

- **Queue/async processing** — added only when a real async consumer exists (the
  avatar flow is synchronous and bounded).
- **Generic media-asset tables / HTTP media API** — added before supporting
  arbitrary user media collections.
- **AVIF / JPEG-fallback output**, **animated formats** — deferred output policy.
- **External transform service** (imgproxy/Thumbor) — for high-volume forks.
- **S3 env-gated integration tests** — optional; CI does not require S3 creds.
