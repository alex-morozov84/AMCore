/**
 * Media processing — public surface.
 *
 * Stage 1 added the processor contract + sharp implementation; Stage 2 adds
 * `MediaService`/`MediaModule` over `StorageService` with deterministic
 * derivative keys and presets. Avatar/queue wiring arrives in later stages.
 * Consumers depend on `MediaService`/`ImageProcessor`, never on `sharp`.
 */
export { DECODABLE_SOURCE_FORMATS, IMAGE_PROCESSOR, OUTPUT_CONTENT_TYPE } from './media.constants'
export { MediaModule } from './media.module'
export { MediaService } from './media.service'
export {
  type ImageDerivativeOutput,
  type ImageDerivativeRecord,
  type ImageDerivativeSpec,
  type ImageInspection,
  type ImageOutputFormat,
  type ImageProcessor,
  type ImageSourceFormat,
  type MediaErrorCode,
  type MediaPreset,
  type MediaPresetName,
  MediaProcessingError,
  type ProcessImageInput,
  type ProcessImageResult,
  type SharpProcessorConfig,
  type SourcePolicy,
} from './media.types'
export { buildDerivativeKey, type DerivativeKeyParts } from './media-key'
export { AVATAR_DERIVATIVES, AVATAR_SOURCE_POLICY } from './presets/avatar.preset'
export { MEDIA_PRESETS } from './presets/media-presets'
export { SharpImageProcessor } from './processors/sharp-image.processor'
export { assertSourceAllowed } from './source-policy'
