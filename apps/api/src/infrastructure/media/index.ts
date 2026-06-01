/**
 * Media processing — public surface.
 *
 * Stage 1 exposes the processor contract, the sharp implementation, source-policy
 * enforcement, and the avatar preset. StorageService/queue/avatar wiring arrives
 * in later stages. Consumers depend on `ImageProcessor`, never on `sharp`.
 */
export { DECODABLE_SOURCE_FORMATS, IMAGE_PROCESSOR, OUTPUT_CONTENT_TYPE } from './media.constants'
export {
  type ImageDerivativeOutput,
  type ImageDerivativeSpec,
  type ImageInspection,
  type ImageOutputFormat,
  type ImageProcessor,
  type ImageSourceFormat,
  type MediaErrorCode,
  MediaProcessingError,
  type SharpProcessorConfig,
  type SourcePolicy,
} from './media.types'
export { AVATAR_DERIVATIVES, AVATAR_SOURCE_POLICY } from './presets/avatar.preset'
export { SharpImageProcessor } from './processors/sharp-image.processor'
export { assertSourceAllowed } from './source-policy'
