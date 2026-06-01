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

// ---------------------------------------------------------------------------
// Service-level contracts (Stage 2 — MediaService over StorageService)
// ---------------------------------------------------------------------------

/** Named presets the service knows how to produce. */
export type MediaPresetName = 'avatar'

/** Static definition of a named derivative set + its source acceptance policy. */
export interface MediaPreset {
  name: MediaPresetName
  /** Object-key namespace/prefix for this preset's outputs, e.g. `avatars`. */
  keyspace: string
  derivatives: readonly ImageDerivativeSpec[]
  sourcePolicy: SourcePolicy
}

export interface ProcessImageInput {
  /** Storage key of the already-stored original to derive from. */
  sourceKey: string
  /**
   * Owner/subject scope for derivative keys. This is key-derivation context
   * ONLY — `MediaService` does not authorize it. Callers must prove the caller
   * owns `sourceKey`/`ownerId` before invoking.
   */
  ownerId: string
  preset: MediaPresetName
  /** Visibility for the generated derivatives. Defaults to `private`. */
  visibility?: 'private' | 'public-read'
  /** Optional per-upload version segment for cache-busting (Stage 3 avatars). */
  version?: string
  /** Optional cache-control for the derivative objects (caller-decided). */
  cacheControl?: string
}

export interface ImageDerivativeRecord {
  name: string
  key: string
  /** Public URL — present only for public-read derivatives on a URL-capable driver. */
  url?: string
  width: number
  height: number
  contentType: string
  size: number
}

export interface ProcessImageResult {
  sourceKey: string
  derivatives: ImageDerivativeRecord[]
}

export type MediaErrorCode =
  | 'UNSUPPORTED_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'DECODE_FAILED'
  | 'SOURCE_TOO_LARGE'
  | 'PUBLIC_URL_UNSUPPORTED'

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
