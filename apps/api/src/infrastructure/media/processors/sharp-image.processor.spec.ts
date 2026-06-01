import sharp from 'sharp'

import {
  type ImageDerivativeSpec,
  MediaProcessingError,
  type SharpProcessorConfig,
} from '../media.types'

import { SharpImageProcessor } from './sharp-image.processor'

const CONFIG: SharpProcessorConfig = {
  limitInputPixels: 40_000_000,
  maxWidth: 8000,
  maxHeight: 8000,
  maxPixels: 40_000_000,
}

const make = (overrides: Partial<SharpProcessorConfig> = {}): SharpImageProcessor =>
  new SharpImageProcessor({ ...CONFIG, ...overrides })

const WEBP_512: ImageDerivativeSpec = {
  name: 'avatar-512',
  width: 512,
  height: 512,
  fit: 'cover',
  format: 'webp',
  quality: 82,
}

// All fixtures are generated at runtime via sharp — no binary fixtures committed.
const jpeg = (w = 64, h = 64): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3498db' } })
    .jpeg()
    .toBuffer()
const png = (w = 64, h = 64): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2ecc71' } })
    .png()
    .toBuffer()
const webp = (w = 64, h = 64): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#e74c3c' } })
    .webp()
    .toBuffer()
const alphaPng = (w = 64, h = 64): Promise<Buffer> =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toBuffer()

// A real 2-frame 4x4 animated GIF (95 bytes, embedded as base64 rather than a
// committed binary). Used to prove inspect() detects multi-page input via actual
// sharp metadata, not a mocked inspection.
const ANIMATED_GIF_BASE64 =
  'R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAAoAAAAsAAAAAAQABACAAP8AAAAAAgSEjwkFADs='
const animatedGif = (): Buffer => Buffer.from(ANIMATED_GIF_BASE64, 'base64')

describe('SharpImageProcessor', () => {
  describe('inspect', () => {
    it('accepts JPEG/PNG/WebP and reports format + dimensions', async () => {
      const proc = make()
      expect(await proc.inspect(await jpeg(80, 40))).toMatchObject({
        format: 'jpeg',
        width: 80,
        height: 40,
      })
      expect(await proc.inspect(await png(30, 30))).toMatchObject({
        format: 'png',
        width: 30,
        height: 30,
      })
      expect(await proc.inspect(await webp(50, 20))).toMatchObject({
        format: 'webp',
        width: 50,
        height: 20,
      })
    })

    it('reports alpha and non-animated for a still image', async () => {
      const result = await make().inspect(await alphaPng())
      expect(result.hasAlpha).toBe(true)
      expect(result.animated).toBe(false)
      expect(result.pages).toBe(1)
    })

    it('rejects spoofed / undecodable bytes as DECODE_FAILED', async () => {
      await expect(
        make().inspect(Buffer.from('this is definitely not an image'))
      ).rejects.toMatchObject({
        code: 'DECODE_FAILED',
      })
    })

    it('rejects an unsupported (non-raster) format as UNSUPPORTED_IMAGE', async () => {
      const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
        .tiff()
        .toBuffer()
      await expect(make().inspect(tiff)).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' })
    })

    it('rejects images over the configured pixel cap as IMAGE_TOO_LARGE', async () => {
      const proc = make({ maxPixels: 100 })
      await expect(proc.inspect(await png(20, 20))).rejects.toMatchObject({
        code: 'IMAGE_TOO_LARGE',
      })
    })

    it('rejects images over the configured width cap as IMAGE_TOO_LARGE', async () => {
      const proc = make({ maxWidth: 40 })
      await expect(proc.inspect(await jpeg(50, 10))).rejects.toBeInstanceOf(MediaProcessingError)
    })

    it('detects a real animated GIF as multi-page (pages > 1)', async () => {
      const result = await make().inspect(animatedGif())
      expect(result.format).toBe('gif')
      expect(result.pages).toBeGreaterThan(1)
      expect(result.animated).toBe(true)
    })
  })

  describe('process', () => {
    it('produces a cover-square WebP with the right content type and size', async () => {
      const out = await make().process(await jpeg(200, 100), WEBP_512)
      expect(out.contentType).toBe('image/webp')
      expect(out.width).toBe(512)
      expect(out.height).toBe(512)
      expect(out.size).toBeGreaterThan(0)
      expect((await sharp(out.buffer).metadata()).format).toBe('webp')
    })

    it('normalizes EXIF orientation before resizing (rotates pixels)', async () => {
      // 40x20 landscape tagged orientation 6 → displayed rotated to 20x40 portrait.
      const oriented = await sharp({
        create: { width: 40, height: 20, channels: 3, background: '#3498db' },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer()

      const out = await make().process(oriented, {
        name: 'orient',
        width: 20,
        fit: 'inside',
        format: 'webp',
        quality: 82,
      })

      // Pixels were physically rotated: output is portrait, not landscape.
      expect(out.height).toBeGreaterThan(out.width)
      // Orientation tag is gone — it was baked in and metadata stripped.
      expect((await sharp(out.buffer).metadata()).orientation).toBeUndefined()
    })

    it('strips source metadata (EXIF) from derivatives', async () => {
      const withExif = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#000' },
      })
        .withExif({ IFD0: { Copyright: 'amcore-test' } })
        .jpeg()
        .toBuffer()
      expect((await sharp(withExif).metadata()).exif).toBeDefined()

      const out = await make().process(withExif, WEBP_512)
      expect((await sharp(out.buffer).metadata()).exif).toBeUndefined()
    })

    it('flattens alpha when the output is JPEG', async () => {
      const out = await make().process(await alphaPng(), {
        name: 'jpg',
        width: 64,
        height: 64,
        fit: 'cover',
        format: 'jpeg',
        quality: 82,
      })
      const meta = await sharp(out.buffer).metadata()
      expect(out.contentType).toBe('image/jpeg')
      expect(meta.format).toBe('jpeg')
      expect(meta.hasAlpha).toBe(false)
    })

    it('preserves alpha for WebP output', async () => {
      const out = await make().process(await alphaPng(), WEBP_512)
      expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true)
    })

    it('enforces pixel caps even without a prior inspect() (IMAGE_TOO_LARGE)', async () => {
      const proc = make({ maxPixels: 100 })
      await expect(proc.process(await png(20, 20), WEBP_512)).rejects.toMatchObject({
        code: 'IMAGE_TOO_LARGE',
      })
    })

    it('rejects undecodable input in process() as DECODE_FAILED', async () => {
      await expect(make().process(Buffer.from('not an image'), WEBP_512)).rejects.toMatchObject({
        code: 'DECODE_FAILED',
      })
    })
  })
})
