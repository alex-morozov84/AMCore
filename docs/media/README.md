# Media Processing

AMCore ships an image-derivative layer on top of [Storage](../storage/README.md).
It decodes uploaded raster images safely, normalizes orientation, strips
metadata, and generates deterministic WebP derivatives — written back through
`StorageService`. The avatar endpoint is the one shipped consumer.

## What Is Included

| Area        | Built-in behavior                                                                  |
| ----------- | ---------------------------------------------------------------------------------- |
| Processor   | `sharp`/libvips behind an `ImageProcessor` contract; consumers never touch `sharp` |
| Safety      | Byte/dimension/pixel caps, `limitInputPixels`, EXIF auto-orient, metadata stripped |
| Derivatives | Named, bounded presets (no client-controlled width/quality) output as WebP         |
| Storage     | Private originals + public-read generated derivatives via `StorageService`         |
| Keys        | Deterministic, per-upload **versioned** keys for immutable caching                 |
| Cleanup     | List-based sweep of superseded versions; fail-closed delete                        |
| Avatar      | `POST/DELETE /auth/me/avatar` is the one shipped consumer                          |

## Mental Model

```
Controller / feature code
  -> MediaService.processImageNow({ sourceKey, ownerId, preset, visibility, version })
      -> ImageProcessor (sharp)      inspect + validate + encode derivatives
      -> StorageService              read original, write derivatives
```

`MediaService` is a **backend primitive**, not an HTTP surface. There is no
generic public image-transform endpoint (e.g. `/images?url=…&w=…`) — only named
presets produced for owned storage objects.

`MediaService` does **not** authorize. `ownerId` is key-derivation context only;
callers must prove the caller owns `sourceKey`/`ownerId` first (the avatar route
does this via bearer auth on `/auth/me/...`).

## Avatar Flow (the shipped example)

```
POST /api/v1/auth/me/avatar   (multipart, bearer)
  1. FileValidationPipe        magic-byte validate (JPEG/PNG/WebP, ≤ 2 MB, no SVG)
  2. store original PRIVATE     avatars/{userId}/v-{version}/original
  3. MediaService.processImageNow → public WebP derivatives:
       avatars/{userId}/v-{version}/avatar-128.webp
       avatars/{userId}/v-{version}/avatar-256.webp
       avatars/{userId}/v-{version}/avatar-512.webp
  4. User.avatarUrl = public URL of avatar-256 (compatibility field)
  5. sweep older versions + the legacy flat object (best-effort)
-> { avatarUrl }
```

`DELETE /auth/me/avatar` removes every object under `avatars/{userId}/` plus the
legacy flat `avatars/{userId}` object, then clears `avatarUrl`. Delete is
**fail-closed**: `avatarUrl` is cleared only after storage cleanup succeeds, so a
failed delete never advertises removal of a still-reachable public object.

Per-upload versioned keys let derivatives carry immutable cache headers without
serving stale content after a re-upload: a new upload publishes a new
`v-{version}/` URL, and the previous version is swept.

### Concurrency

Concurrent avatar mutations for one user are made safe by a **monotonic generation
fence in the database**, not by the lock alone (see ADR-049):

- **Generation CAS.** `User.avatarGeneration` increases by one per mutation. The
  publish (and the delete) is a conditional update that only lands while the stored
  generation is still older. A request that lost the race to a newer concurrent
  mutation matches no row and fails closed — it can never overwrite the newer state.
- **Generation-bounded sweep.** Versions are stored as `v-<generation>-<rand>`, and
  a mutation only ever deletes versions **strictly older than its own generation**.
  Since committed generations strictly increase, a request can never delete the
  current or a newer version — even if its process paused and lost the lock lease.

A per-user **Redis lock** still serializes the common case to avoid duplicate image
work, but it is best-effort and not relied on for correctness. Under lock
contention, a lost generation race, or a Redis outage the request **fails closed**
with a retriable `503` (`errorCode: AVATAR_LOCKED`). A future generic file-upload
feature with the same single-pointer + sweep pattern should reuse this
generation-fence approach (and `RedisMutexService` for serialization).

## Guides

- [Configuration](./configuration.md) — `MEDIA_*` env vars, presets, Next.js consumption.
- [Security](./security.md) — accepted formats, limits, EXIF, isolation, deferred scope.

## Status

Implemented: synchronous processing + the avatar consumer. **Deferred** (see
[Security → Deferred scope](./security.md#deferred-scope)): queue/async
processing, generic media-asset tables/APIs, AVIF/JPEG-fallback output, animated
formats, and an external transform service.
