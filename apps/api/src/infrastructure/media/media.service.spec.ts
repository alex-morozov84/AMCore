import sharp from 'sharp'

import { MediaService } from './media.service'
import { SharpImageProcessor } from './processors/sharp-image.processor'

import type { EnvService } from '@/env/env.service'
import type { StorageService } from '@/infrastructure/storage'

const ANIMATED_GIF = Buffer.from(
  'R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAAoAAAAsAAAAAAQABACAAP8AAAAAAgSEjwkFADs=',
  'base64'
)

const jpeg = (w = 200, h = 100): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3498db' } })
    .jpeg()
    .toBuffer()
const png = (w = 20, h = 20): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2ecc71' } })
    .png()
    .toBuffer()

interface StorageOverrides {
  contentLength?: number
  buffer?: Buffer
  publicUrls?: boolean
}

const makeStorage = (over: StorageOverrides = {}) => {
  const stub = {
    getMetadata: jest.fn().mockResolvedValue({ contentLength: over.contentLength ?? 1000 }),
    download: jest.fn().mockResolvedValue(over.buffer ?? Buffer.alloc(0)),
    upload: jest.fn().mockResolvedValue({ key: 'k', size: 1 }),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    getPublicUrl: jest.fn((k: string) => `https://cdn.test/${k}`),
    capabilities: { publicUrls: over.publicUrls ?? true, signedUrls: false },
  }
  return stub as unknown as StorageService & typeof stub
}

const makeEnv = (over: Record<string, number> = {}) => {
  const values: Record<string, number> = {
    MEDIA_MAX_SOURCE_BYTES: 5_000_000,
    MEDIA_AVATAR_MAX_PIXELS: 8_000_000,
    MEDIA_MAX_PIXELS: 40_000_000,
    ...over,
  }
  return { get: jest.fn((k: string) => values[k]) } as unknown as EnvService
}

const processor = new SharpImageProcessor({
  limitInputPixels: 40_000_000,
  maxWidth: 8000,
  maxHeight: 8000,
  maxPixels: 40_000_000,
})

describe('MediaService.processImageNow', () => {
  it('generates avatar derivatives with deterministic public keys + URLs', async () => {
    const storage = makeStorage({ buffer: await jpeg() })
    const result = await new MediaService(storage, processor, makeEnv()).processImageNow({
      sourceKey: 'avatars/u1/original',
      ownerId: 'u1',
      preset: 'avatar',
      visibility: 'public-read',
    })

    expect(result.derivatives.map((d) => d.key)).toEqual([
      'avatars/u1/avatar-128.webp',
      'avatars/u1/avatar-256.webp',
      'avatars/u1/avatar-512.webp',
    ])
    expect(storage.upload).toHaveBeenCalledTimes(3)
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'avatars/u1/avatar-256.webp', visibility: 'public-read' })
    )
    const d512 = result.derivatives[2]
    if (!d512) throw new Error('expected three derivatives')
    expect(d512).toMatchObject({
      width: 512,
      height: 512,
      contentType: 'image/webp',
      url: 'https://cdn.test/avatars/u1/avatar-512.webp',
    })
    expect(d512.size).toBeGreaterThan(0)
  })

  it('inserts a version segment when one is supplied', async () => {
    const storage = makeStorage({ buffer: await jpeg() })
    const result = await new MediaService(storage, processor, makeEnv()).processImageNow({
      sourceKey: 'avatars/u1/original',
      ownerId: 'u1',
      preset: 'avatar',
      version: 'abc7',
      visibility: 'public-read',
    })
    expect(result.derivatives[0]?.key).toBe('avatars/u1/v-abc7/avatar-128.webp')
  })

  it('writes private and omits URLs when visibility is private', async () => {
    const storage = makeStorage({ buffer: await jpeg() })
    const result = await new MediaService(storage, processor, makeEnv()).processImageNow({
      sourceKey: 'avatars/u1/original',
      ownerId: 'u1',
      preset: 'avatar',
    })
    expect(result.derivatives.every((d) => d.url === undefined)).toBe(true)
    expect(storage.upload).toHaveBeenCalledWith(expect.objectContaining({ visibility: undefined }))
    expect(storage.getPublicUrl).not.toHaveBeenCalled()
  })

  it('rejects an oversized source BEFORE downloading (F2)', async () => {
    const storage = makeStorage({ contentLength: 9_000_000 })
    await expect(
      new MediaService(storage, processor, makeEnv()).processImageNow({
        sourceKey: 'avatars/u1/original',
        ownerId: 'u1',
        preset: 'avatar',
      })
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('fails fast when public-read is requested but the driver has no public URLs', async () => {
    const storage = makeStorage({ publicUrls: false })
    await expect(
      new MediaService(storage, processor, makeEnv()).processImageNow({
        sourceKey: 'avatars/u1/original',
        ownerId: 'u1',
        preset: 'avatar',
        visibility: 'public-read',
      })
    ).rejects.toMatchObject({ code: 'PUBLIC_URL_UNSUPPORTED' })
    expect(storage.getMetadata).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a source over the preset pixel cap', async () => {
    const storage = makeStorage({ buffer: await png(20, 20) })
    await expect(
      new MediaService(
        storage,
        processor,
        makeEnv({ MEDIA_AVATAR_MAX_PIXELS: 100 })
      ).processImageNow({
        sourceKey: 'avatars/u1/original',
        ownerId: 'u1',
        preset: 'avatar',
      })
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a disallowed source format for the avatar preset (animated gif)', async () => {
    const storage = makeStorage({ buffer: ANIMATED_GIF })
    await expect(
      new MediaService(storage, processor, makeEnv()).processImageNow({
        sourceKey: 'avatars/u1/original',
        ownerId: 'u1',
        preset: 'avatar',
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' })
    expect(storage.upload).not.toHaveBeenCalled()
  })
})

describe('MediaService.deleteDerivatives', () => {
  it('deletes a known set of keys', async () => {
    const storage = makeStorage()
    await new MediaService(storage, processor, makeEnv()).deleteDerivatives(['a.webp', 'b.webp'])
    expect(storage.deleteMany).toHaveBeenCalledWith(['a.webp', 'b.webp'])
  })

  it('is a no-op for an empty list', async () => {
    const storage = makeStorage()
    await new MediaService(storage, processor, makeEnv()).deleteDerivatives([])
    expect(storage.deleteMany).not.toHaveBeenCalled()
  })
})
