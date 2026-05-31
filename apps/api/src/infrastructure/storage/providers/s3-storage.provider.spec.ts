import { DeleteObjectsCommand, type DeleteObjectsCommandInput, S3Client } from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'

import { runStorageProviderContract } from '../storage.contract-spec'
import { StorageDeleteManyException } from '../storage.interface'

import { setupS3Mock } from './s3-mock'
import { type S3StorageConfig, S3StorageProvider } from './s3-storage.provider'

function makeProvider(overrides: Partial<S3StorageConfig> = {}): S3StorageProvider {
  return new S3StorageProvider({
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    signedUrlDefaultTtl: 3600,
    signedUrlMaxTtl: 604800,
    ...overrides,
  })
}

describe('S3StorageProvider', () => {
  describe('contract + backend behavior', () => {
    let restore: () => void

    beforeEach(() => {
      ;({ restore } = setupS3Mock())
    })

    afterEach(() => restore())

    runStorageProviderContract('s3', () => makeProvider(), { signedUrls: true, publicUrls: true })

    it('uses lib-storage multipart for buffers above the threshold', async () => {
      const provider = makeProvider({ multipartThreshold: 5 * 1024 * 1024 })
      const big = Buffer.alloc(6 * 1024 * 1024, 7)
      const result = await provider.upload({ key: 'big/file.bin', body: big })
      expect(result.size).toBe(big.length)
      expect(result).not.toHaveProperty('url')
      const back = await provider.download('big/file.bin')
      expect(back.equals(big)).toBe(true)
    })

    it('tags public-read visibility in object metadata', async () => {
      const provider = makeProvider()
      await provider.upload({ key: 'pub.txt', body: Buffer.from('x'), visibility: 'public-read' })
      expect((await provider.getMetadata('pub.txt')).visibility).toBe('public-read')
    })
  })

  describe('deleteMany', () => {
    it('chunks into batches of at most 1000 keys', async () => {
      const s3Mock = mockClient(S3Client)
      const batchSizes: number[] = []
      s3Mock.on(DeleteObjectsCommand).callsFake((input: DeleteObjectsCommandInput) => {
        batchSizes.push(input.Delete?.Objects?.length ?? 0)
        return { Deleted: [] }
      })
      const keys = Array.from({ length: 2001 }, (_, i) => `k/${i}.txt`)
      await makeProvider().deleteMany(keys)
      expect(batchSizes).toEqual([1000, 1000, 1])
      s3Mock.restore()
    })

    it('throws StorageDeleteManyException with { key, code } on per-key errors', async () => {
      const s3Mock = mockClient(S3Client)
      s3Mock.on(DeleteObjectsCommand).callsFake((input: DeleteObjectsCommandInput) => ({
        Errors: (input.Delete?.Objects ?? [])
          .filter((o) => o.Key?.includes('bad'))
          .map((o) => ({ Key: o.Key, Code: 'AccessDenied' })),
      }))
      const provider = makeProvider()

      await expect(provider.deleteMany(['ok/1.txt', 'bad/2.txt'])).rejects.toBeInstanceOf(
        StorageDeleteManyException
      )
      await expect(provider.deleteMany(['bad/x.txt'])).rejects.toMatchObject({
        failures: [{ key: 'bad/x.txt', code: 'AccessDenied' }],
      })
      s3Mock.restore()
    })
  })

  describe('signed URLs (TTL clamped server-side)', () => {
    it('clamps the download TTL to the configured max', async () => {
      const provider = makeProvider({
        endpoint: 'https://s3.example.com',
        publicEndpoint: 'https://cdn.example.com',
      })
      const url = new URL(
        await provider.getSignedDownloadUrl({ key: 'a/b.png', expiresIn: 999999 })
      )
      expect(url.host.endsWith('cdn.example.com')).toBe(true) // public endpoint, not internal
      expect(url.searchParams.get('X-Amz-Expires')).toBe('604800')
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
    })

    it('uses the default TTL for uploads when none is provided', async () => {
      const provider = makeProvider({
        endpoint: 'https://s3.example.com',
        signedUrlDefaultTtl: 1800,
      })
      const url = new URL(await provider.getSignedUploadUrl({ key: 'a/b.png' }))
      expect(url.searchParams.get('X-Amz-Expires')).toBe('1800')
    })
  })

  describe('getPublicUrl', () => {
    it('builds a virtual-hosted url from the endpoint', () => {
      const provider = makeProvider({ endpoint: 'https://s3.example.com', bucket: 'media' })
      expect(provider.getPublicUrl('a/b.png')).toBe('https://media.s3.example.com/a/b.png')
    })

    it('builds a path-style url when forcePathStyle is set', () => {
      const provider = makeProvider({
        endpoint: 'https://s3.example.com',
        bucket: 'media',
        forcePathStyle: true,
      })
      expect(provider.getPublicUrl('a/b.png')).toBe('https://s3.example.com/media/a/b.png')
    })

    it('treats the public endpoint as an already-public base (no bucket synthesis)', () => {
      const provider = makeProvider({
        endpoint: 'https://internal:9000',
        publicEndpoint: 'https://cdn.example.com',
        bucket: 'media',
      })
      expect(provider.getPublicUrl('x.png')).toBe('https://cdn.example.com/x.png')
    })

    it('concatenates onto a public base that includes a path', () => {
      const provider = makeProvider({
        publicEndpoint: 'https://cdn.example.com/assets/',
        bucket: 'media',
      })
      expect(provider.getPublicUrl('avatars/u1.webp')).toBe(
        'https://cdn.example.com/assets/avatars/u1.webp'
      )
    })

    it('falls back to the AWS virtual-hosted host without an endpoint', () => {
      const provider = makeProvider({ bucket: 'media', region: 'eu-west-1' })
      expect(provider.getPublicUrl('x.png')).toBe('https://media.s3.eu-west-1.amazonaws.com/x.png')
    })
  })

  describe('client configuration', () => {
    it('sets checksum calc/validation to WHEN_REQUIRED (non-AWS compatibility)', async () => {
      const provider = makeProvider({ endpoint: 'https://s3.example.com' })
      const client = (provider as unknown as { client: S3Client }).client
      expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED')
      expect(await client.config.responseChecksumValidation()).toBe('WHEN_REQUIRED')
    })
  })
})
