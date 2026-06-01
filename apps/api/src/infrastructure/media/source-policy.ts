import { type ImageInspection, MediaProcessingError, type SourcePolicy } from './media.types'

/**
 * Enforce preset-level source acceptance on an already-inspected image.
 *
 * The processor's `inspect()` guarantees a decodable raster within the global
 * decode-safety caps. This adds the preset-specific gate: which formats are
 * acceptable for THIS use case, and whether animation is allowed. Avatars, for
 * example, reject animated input rather than silently using the first frame.
 *
 * Throws {@link MediaProcessingError} (`UNSUPPORTED_IMAGE`) — a deterministic
 * failure — so callers and the future queue worker treat it as unrecoverable.
 */
export function assertSourceAllowed(inspection: ImageInspection, policy: SourcePolicy): void {
  if (!policy.allowedFormats.includes(inspection.format)) {
    throw new MediaProcessingError(
      `Source format "${inspection.format}" is not accepted by this preset`,
      'UNSUPPORTED_IMAGE'
    )
  }

  if (inspection.animated && !policy.allowAnimated) {
    throw new MediaProcessingError(
      'Animated/multi-page images are not accepted by this preset',
      'UNSUPPORTED_IMAGE'
    )
  }
}
