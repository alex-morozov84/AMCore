/**
 * Media Processing — Image Processor Contract & Types
 *
 * Stage 1 (processor foundation) defines the contract + a `sharp`-backed
 * implementation only. No StorageService, queue, or avatar wiring yet — that is
 * Stage 2+. Consumers never instantiate `sharp` directly; they depend on the
 * `ImageProcessor` contract (see ai/MEDIA_PROCESSING_PLAN.md).
 */

/** Raster formats `inspect()` can report from a decoded source. */
export type ImageSourceFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif'

/** Formats a derivative can be encoded to. */
export type ImageOutputFormat = 'jpeg' | 'webp' | 'avif' | 'png'

/** Result of probing a source image's header (no full decode). */
export interface ImageInspection {
  format: ImageSourceFormat
  width: number
  height: number
  /** Frame/page count; 1 for still images. */
  pages: number
  animated: boolean
  hasAlpha: boolean
  /** EXIF orientation (1-8) when present on the source. */
  orientation?: number
}

/** A single derivative to produce. */
export interface ImageDerivativeSpec {
  name: string
  width: number
  height?: number
  fit: 'cover' | 'inside'
  position?: 'center' | 'entropy' | 'attention'
  format: ImageOutputFormat
  quality: number
}

/** Encoded derivative bytes plus the produced object's facts. */
export interface ImageDerivativeOutput {
  buffer: Buffer
  contentType: string
  width: number
  height: number
  size: number
}

/**
 * Low-level image engine. `inspect` probes safely (header + decode-safety
 * limits); `process` normalizes orientation, strips metadata, and encodes one
 * derivative. Preset-level acceptance (which formats, animation) is enforced
 * separately — see {@link SourcePolicy} / `assertSourceAllowed`.
 */
export interface ImageProcessor {
  inspect(input: Buffer): Promise<ImageInspection>
  process(input: Buffer, spec: ImageDerivativeSpec): Promise<ImageDerivativeOutput>
}

/** Decode-safety caps the processor enforces (sourced from env in Stage 2). */
export interface SharpProcessorConfig {
  /** Hard libvips decode guard, passed as sharp `limitInputPixels`. */
  limitInputPixels: number
  maxWidth: number
  maxHeight: number
  maxPixels: number
}

/** Preset-level source acceptance policy (e.g. avatar rejects animation). */
export interface SourcePolicy {
  allowedFormats: readonly ImageSourceFormat[]
  allowAnimated: boolean
}

export type MediaErrorCode = 'UNSUPPORTED_IMAGE' | 'IMAGE_TOO_LARGE' | 'DECODE_FAILED'

/**
 * Deterministic media failure. Every case here is unrecoverable (the same bytes
 * + same code will not heal on retry), so Stage 3's queue worker maps these to
 * BullMQ `UnrecoverableError`. Carries a discriminating `code`, never raw bytes.
 */
export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly code: MediaErrorCode
  ) {
    super(message)
    this.name = 'MediaProcessingError'
  }
}
