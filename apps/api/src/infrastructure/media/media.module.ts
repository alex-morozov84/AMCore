import { Module } from '@nestjs/common'

import { IMAGE_PROCESSOR } from './media.constants'
import { MediaService } from './media.service'
import { SharpImageProcessor } from './processors/sharp-image.processor'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'
import { ObservabilityModule } from '@/infrastructure/observability'

/**
 * Media processing module. Binds the active `ImageProcessor` (sharp, configured
 * from `MEDIA_*` env) and exposes `MediaService`, which composes over the global
 * `StorageService`. The current avatar upload flow consumes it synchronously.
 */
@Module({
  imports: [EnvModule, ObservabilityModule],
  providers: [
    {
      provide: IMAGE_PROCESSOR,
      inject: [EnvService],
      useFactory: (env: EnvService): SharpImageProcessor =>
        new SharpImageProcessor({
          limitInputPixels: env.get('MEDIA_SHARP_LIMIT_INPUT_PIXELS'),
          maxWidth: env.get('MEDIA_MAX_WIDTH'),
          maxHeight: env.get('MEDIA_MAX_HEIGHT'),
          maxPixels: env.get('MEDIA_MAX_PIXELS'),
        }),
    },
    MediaService,
  ],
  exports: [MediaService],
})
export class MediaModule {}
