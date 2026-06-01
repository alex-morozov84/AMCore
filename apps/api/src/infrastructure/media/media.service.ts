import { Inject, Injectable } from '@nestjs/common'

import { IMAGE_PROCESSOR } from './media.constants'
import {
  type ImageDerivativeRecord,
  type ImageProcessor,
  type MediaPresetName,
  MediaProcessingError,
  type ProcessImageInput,
  type ProcessImageResult,
} from './media.types'
import { buildDerivativeKey } from './media-key'
import { MEDIA_PRESETS } from './presets/media-presets'
import { assertSourceAllowed } from './source-policy'

import { EnvService } from '@/env/env.service'
import { StorageService } from '@/infrastructure/storage'

/**
 * Generates deterministic image derivatives on top of `StorageService`.
 *
 * Flow: size-guard the source via `getMetadata` BEFORE download (F2), download,
 * decode/validate (processor caps + preset source-policy + preset pixel cap),
 * then process+upload each derivative. Authorization is the caller's job — see
 * {@link ProcessImageInput.ownerId}.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly storage: StorageService,
    @Inject(IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
    private readonly env: EnvService
  ) {}

  async processImageNow(input: ProcessImageInput): Promise<ProcessImageResult> {
    const preset = MEDIA_PRESETS[input.preset]
    this.assertPublicUrlCapability(input.visibility)

    const buffer = await this.loadValidatedSource(input.sourceKey)
    const inspection = await this.processor.inspect(buffer)
    assertSourceAllowed(inspection, preset.sourcePolicy)
    this.assertPresetPixels(inspection.width * inspection.height, input.preset)

    const derivatives: ImageDerivativeRecord[] = []
    for (const spec of preset.derivatives) {
      const output = await this.processor.process(buffer, spec)
      const key = buildDerivativeKey({
        keyspace: preset.keyspace,
        ownerId: input.ownerId,
        version: input.version,
        variant: spec.name,
        format: spec.format,
      })
      await this.storage.upload({
        key,
        body: output.buffer,
        contentType: output.contentType,
        cacheControl: input.cacheControl,
        visibility: input.visibility,
      })
      derivatives.push({
        name: spec.name,
        key,
        url: input.visibility === 'public-read' ? this.storage.getPublicUrl(key) : undefined,
        width: output.width,
        height: output.height,
        contentType: output.contentType,
        size: output.size,
      })
    }
    return { sourceKey: input.sourceKey, derivatives }
  }

  /** Delete a known set of derivative keys. No-op for an empty list. */
  async deleteDerivatives(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this.storage.deleteMany(keys)
  }

  /** Fail fast if public-read is requested but the driver can't produce URLs. */
  private assertPublicUrlCapability(visibility: ProcessImageInput['visibility']): void {
    if (visibility === 'public-read' && !this.storage.capabilities.publicUrls) {
      throw new MediaProcessingError(
        'public-read derivatives require a storage driver that supports public URLs',
        'PUBLIC_URL_UNSUPPORTED'
      )
    }
  }

  private async loadValidatedSource(sourceKey: string): Promise<Buffer> {
    const maxBytes = this.env.get('MEDIA_MAX_SOURCE_BYTES')
    const { contentLength } = await this.storage.getMetadata(sourceKey)
    if (contentLength > maxBytes) {
      throw new MediaProcessingError(
        `Source object is ${contentLength} bytes, exceeding the ${maxBytes}-byte limit`,
        'SOURCE_TOO_LARGE'
      )
    }
    return this.storage.download(sourceKey)
  }

  private assertPresetPixels(pixels: number, preset: MediaPresetName): void {
    const cap =
      preset === 'avatar'
        ? this.env.get('MEDIA_AVATAR_MAX_PIXELS')
        : this.env.get('MEDIA_MAX_PIXELS')
    if (pixels > cap) {
      throw new MediaProcessingError(
        `Decoded image (${pixels}px) exceeds the ${preset} cap of ${cap}px`,
        'IMAGE_TOO_LARGE'
      )
    }
  }
}
