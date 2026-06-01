import type { ImageOutputFormat, ImageSourceFormat } from './media.types'

/**
 * DI token for the active `ImageProcessor`. Wired to `SharpImageProcessor` by
 * `MediaModule` in Stage 2; declared here so the contract and token live with
 * the types rather than in the (not-yet-created) module.
 */
export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR')

/**
 * Raster formats `inspect()` recognizes and reports. This is the decode-level
 * union, NOT the acceptance policy: a preset narrows it further (avatars accept
 * only jpeg/png/webp — see avatar.preset). Anything outside this set (SVG, TIFF,
 * HEIC, ...) is rejected as `UNSUPPORTED_IMAGE`. SVG is never accepted anywhere
 * (stored-XSS / unreliable magic bytes).
 */
export const DECODABLE_SOURCE_FORMATS: readonly ImageSourceFormat[] = [
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
]

/** MIME type written as `contentType` for each encoded derivative format. */
export const OUTPUT_CONTENT_TYPE: Record<ImageOutputFormat, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
}

/** File extension used in derivative object keys for each output format. */
export const OUTPUT_EXT: Record<ImageOutputFormat, string> = {
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
  png: 'png',
}
