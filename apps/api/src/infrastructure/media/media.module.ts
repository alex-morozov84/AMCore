import { Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module.js'
import { EnvService } from '../../env/env.service.js'
import { ObservabilityModule } from '../observability/index.js'

import { IMAGE_PROCESSOR } from './media.constants.js'
import { MediaService } from './media.service.js'
import { SharpImageProcessor } from './processors/sharp-image.processor.js'

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
