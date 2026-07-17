import sharp, { type Metadata, type Sharp } from 'sharp'

import { DECODABLE_SOURCE_FORMATS, OUTPUT_CONTENT_TYPE } from '../media.constants'
import {
  type ImageDerivativeOutput,
  type ImageDerivativeSpec,
  type ImageInspection,
  type ImageProcessor,
  type ImageSourceFormat,
  MediaProcessingError,
  type SharpProcessorConfig,
} from '../media.types'

/**
 * `sharp`/libvips-backed image processor.
 *
 * Safety model (ai/MEDIA_PROCESSING_PLAN.md):
 * - every decode passes `limitInputPixels` (hard libvips guard);
 * - `inspect()` additionally rejects unknown formats, missing dimensions, and
 *   images over the configured dimension/pixel caps before any expensive work;
 * - `process()` auto-orients from EXIF *before* resizing and never preserves
 *   metadata (sharp strips it unless `keepMetadata()` is called — we never do),
 *   so derivatives carry no EXIF/GPS/ICC.
 */
export class SharpImageProcessor implements ImageProcessor {
  constructor(private readonly config: SharpProcessorConfig) {}

  async inspect(input: Buffer): Promise<ImageInspection> {
    const meta = await this.readMetadata(input)
    const format = this.normalizeFormat(meta.format)
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (width <= 0 || height <= 0) {
      throw new MediaProcessingError('Image has missing or zero dimensions', 'UNSUPPORTED_IMAGE')
    }
    this.assertWithinLimits(width, height)

    const pages = meta.pages ?? 1
    return {
      format,
      width,
      height,
      pages,
      animated: pages > 1,
      hasAlpha: meta.hasAlpha ?? false,
      orientation: meta.orientation,
    }
  }

  async process(input: Buffer, spec: ImageDerivativeSpec): Promise<ImageDerivativeOutput> {
    // `process()` is a public entrypoint: enforce decode-safety (format,
    // dimensions, pixel/dimension caps) here too, so it is never reliant on the
    // caller having run `inspect()` first. `limitInputPixels` alone bounds only
    // the catastrophic case; the configured caps can be stricter.
    await this.inspect(input)

    const resized = sharp(input, {
      limitInputPixels: this.config.limitInputPixels,
      animated: false,
    })
      // Auto-orient from EXIF before resize; bakes rotation into pixels so the
      // (then stripped) orientation tag is no longer needed.
      .rotate()
      .resize({
        width: spec.width,
        height: spec.height,
        fit: spec.fit,
        position: spec.position ?? 'center',
      })

    const { data, info } = await this.encode(resized, spec).toBuffer({ resolveWithObject: true })
    return {
      buffer: data,
      contentType: OUTPUT_CONTENT_TYPE[spec.format],
      width: info.width,
      height: info.height,
      size: info.size,
    }
  }

  private async readMetadata(input: Buffer): Promise<Metadata> {
    try {
      return await sharp(input, { limitInputPixels: this.config.limitInputPixels }).metadata()
    } catch {
      throw new MediaProcessingError('Input is not a decodable image', 'DECODE_FAILED')
    }
  }

  private normalizeFormat(format: string | undefined): ImageSourceFormat {
    if (format && (DECODABLE_SOURCE_FORMATS as readonly string[]).includes(format)) {
      return format as ImageSourceFormat
    }
    throw new MediaProcessingError(
      `Unsupported source format: ${format ?? 'unknown'}`,
      'UNSUPPORTED_IMAGE'
    )
  }

  private assertWithinLimits(width: number, height: number): void {
    const { maxWidth, maxHeight, maxPixels } = this.config
    if (width > maxWidth || height > maxHeight || width * height > maxPixels) {
      throw new MediaProcessingError(
        `Image ${width}x${height} exceeds configured dimension/pixel limits`,
        'IMAGE_TOO_LARGE'
      )
    }
  }

  /** Apply the output encoder. Metadata is dropped by default (no keepMetadata). */
  private encode(pipeline: Sharp, spec: ImageDerivativeSpec): Sharp {
    switch (spec.format) {
      case 'jpeg':
        // JPEG has no alpha channel: flatten transparency onto white first.
        return pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: spec.quality })
      case 'webp':
        return pipeline.webp({ quality: spec.quality })
      case 'avif':
        return pipeline.avif({ quality: spec.quality })
      case 'png':
        return pipeline.png({ quality: spec.quality })
    }
  }
}
