import {
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type DeleteObjectsCommandInput,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'

import { InvalidObjectKeyError } from '../object-key'
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
    publicBaseUrl: 'https://cdn.example.com',
    signedUrlDefaultTtl: 3600,
    signedUrlMaxTtl: 604800,
    ...overrides,
  })
}

const body = Buffer.from('x')

describe('S3StorageProvider', () => {
  describe('contract + backend behavior', () => {
    let restore: () => void

    beforeEach(() => {
      ;({ restore } = setupS3Mock())
    })

    afterEach(() => restore())

    runStorageProviderContract('s3', () => makeProvider(), { signedUrls: true, publicUrls: true })
    runStorageProviderContract(
      's3 (two buckets, acl mode)',
      () => makeProvider({ publicBucket: 'public-bucket', publicDelivery: 'acl' }),
      {
        signedUrls: true,
        separateNamespaces: true,
        publicUrls: true,
      }
    )

    it('uses lib-storage multipart for buffers above the threshold', async () => {
      const provider = makeProvider({ multipartThreshold: 5 * 1024 * 1024 })
      const big = Buffer.alloc(6 * 1024 * 1024, 7)
      const result = await provider.upload({ key: 'big/file.bin', body: big })
      expect(result.size).toBe(big.length)
      expect(result).not.toHaveProperty('url')
      const back = await provider.download('big/file.bin')
      expect(back.equals(big)).toBe(true)
    })
  })

  describe('public delivery mode (ACL header)', () => {
    let mock: ReturnType<typeof setupS3Mock>['mock']
    let restore: () => void

    beforeEach(() => {
      ;({ mock, restore } = setupS3Mock())
    })

    afterEach(() => restore())

    const putAcl = (key: string): unknown =>
      mock.commandCalls(PutObjectCommand).find((c) => c.args[0].input.Key === key)?.args[0].input
        .ACL

    it('external (default) never sends an ACL, for public or private keys', async () => {
      const provider = makeProvider()
      await provider.upload({ key: 'public/a.webp', body })
      await provider.upload({ key: 'docs/a.pdf', body })
      await provider.copy({ source: 'public/a.webp', destination: 'public/b.webp' })
      expect(putAcl('public/a.webp')).toBeUndefined()
      expect(putAcl('docs/a.pdf')).toBeUndefined()
      expect(mock.commandCalls(CopyObjectCommand)[0]?.args[0].input.ACL).toBeUndefined()
    })

    it('api mode never sends an ACL either: the API reads the object with its own credentials', async () => {
      const provider = makeProvider({ publicDelivery: 'api' })
      await provider.upload({ key: 'public/a.webp', body })
      await provider.copy({ source: 'public/a.webp', destination: 'public/b.webp' })
      expect(putAcl('public/a.webp')).toBeUndefined()
      expect(mock.commandCalls(CopyObjectCommand)[0]?.args[0].input.ACL).toBeUndefined()
    })

    it('acl sends public-read only for public keys, on upload and on copy', async () => {
      const provider = makeProvider({ publicDelivery: 'acl' })
      await provider.upload({ key: 'public/a.webp', body })
      await provider.upload({ key: 'docs/a.pdf', body })
      await provider.copy({ source: 'public/a.webp', destination: 'public/b.webp' })
      await provider.copy({ source: 'docs/a.pdf', destination: 'docs/b.pdf' })
      expect(putAcl('public/a.webp')).toBe('public-read')
      expect(putAcl('docs/a.pdf')).toBeUndefined()
      const copies = mock.commandCalls(CopyObjectCommand).map((c) => c.args[0].input)
      expect(copies.find((c) => c.Key === 'public/b.webp')?.ACL).toBe('public-read')
      expect(copies.find((c) => c.Key === 'docs/b.pdf')?.ACL).toBeUndefined()
    })

    it('acl applies the ACL to multipart uploads of public keys', async () => {
      const provider = makeProvider({ publicDelivery: 'acl', multipartThreshold: 1024 })
      await provider.upload({ key: 'public/big.bin', body: Buffer.alloc(6 * 1024 * 1024, 1) })
      expect(mock.commandCalls(CreateMultipartUploadCommand)[0]?.args[0].input.ACL).toBe(
        'public-read'
      )
    })

    it('does not write a visibility tag into object metadata', async () => {
      const provider = makeProvider()
      await provider.upload({ key: 'public/a.webp', body, metadata: { owner: 'u1' } })
      expect(mock.commandCalls(PutObjectCommand)[0]?.args[0].input.Metadata).toEqual({
        owner: 'u1',
      })
    })

    it('derives metadata visibility from the key, not from object metadata', async () => {
      const provider = makeProvider()
      await provider.upload({ key: 'public/a.webp', body })
      await provider.upload({ key: 'docs/a.pdf', body })
      expect((await provider.getMetadata('public/a.webp')).visibility).toBe('public-read')
      expect((await provider.getMetadata('docs/a.pdf')).visibility).toBe('private')
    })
  })

  describe('bucket routing', () => {
    let mock: ReturnType<typeof setupS3Mock>['mock']
    let restore: () => void

    beforeEach(() => {
      ;({ mock, restore } = setupS3Mock())
    })

    afterEach(() => restore())

    const two = (): S3StorageProvider =>
      makeProvider({ bucket: 'private-bucket', publicBucket: 'public-bucket' })

    it('sends public keys to the public bucket and everything else to the private bucket', async () => {
      const provider = two()
      await provider.upload({ key: 'public/a.webp', body })
      await provider.upload({ key: 'avatars/u1/original', body })
      await provider.exists('public/a.webp')
      await provider.getMetadata('avatars/u1/original')
      await provider.download('public/a.webp')
      await provider.delete('avatars/u1/original')
      const bucketOf = (command: typeof PutObjectCommand | typeof HeadObjectCommand, key: string) =>
        mock
          .commandCalls(command as typeof PutObjectCommand)
          .find((c) => c.args[0].input.Key === key)?.args[0].input.Bucket
      expect(bucketOf(PutObjectCommand, 'public/a.webp')).toBe('public-bucket')
      expect(bucketOf(PutObjectCommand, 'avatars/u1/original')).toBe('private-bucket')
      expect(bucketOf(HeadObjectCommand, 'public/a.webp')).toBe('public-bucket')
      expect(bucketOf(HeadObjectCommand, 'avatars/u1/original')).toBe('private-bucket')
      expect(mock.commandCalls(GetObjectCommand)[0]?.args[0].input.Bucket).toBe('public-bucket')
      expect(mock.commandCalls(DeleteObjectCommand)[0]?.args[0].input.Bucket).toBe('private-bucket')
    })

    it('copies inside the bucket that owns the namespace', async () => {
      const provider = two()
      await provider.upload({ key: 'public/a.webp', body })
      await provider.copy({ source: 'public/a.webp', destination: 'public/b.webp' })
      expect(mock.commandCalls(CopyObjectCommand)[0]?.args[0].input).toMatchObject({
        Bucket: 'public-bucket',
        CopySource: 'public-bucket/public/a.webp',
        Key: 'public/b.webp',
      })
    })

    it('groups deleteMany by bucket', async () => {
      const provider = two()
      const calls: { bucket?: string; keys: string[] }[] = []
      mock.on(DeleteObjectsCommand).callsFake((input: DeleteObjectsCommandInput) => {
        calls.push({
          bucket: input.Bucket,
          keys: (input.Delete?.Objects ?? []).map((o) => o.Key ?? ''),
        })
        return {}
      })
      await provider.deleteMany(['public/a.webp', 'avatars/u1/original', 'public/b.webp'])
      expect(calls).toEqual([
        { bucket: 'public-bucket', keys: ['public/a.webp', 'public/b.webp'] },
        { bucket: 'private-bucket', keys: ['avatars/u1/original'] },
      ])
    })

    it('routes list by prefix and refuses a prefix that spans both buckets', async () => {
      const provider = two()
      await provider.list({ prefix: 'public/avatars/u1/' })
      await provider.list({ prefix: 'avatars/u1/' })
      const buckets = mock.commandCalls(ListObjectsV2Command).map((c) => c.args[0].input.Bucket)
      expect(buckets).toEqual(['public-bucket', 'private-bucket'])
      await expect(provider.list({ prefix: '' })).rejects.toBeInstanceOf(InvalidObjectKeyError)
      await expect(provider.list({ prefix: 'pu' })).rejects.toBeInstanceOf(InvalidObjectKeyError)
    })

    it('allows any list prefix when one bucket holds both namespaces', async () => {
      await expect(makeProvider().list({ prefix: '' })).resolves.toMatchObject({ files: [] })
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
      const provider = makeProvider({ endpoint: 'https://s3.example.com' })
      const url = new URL(
        await provider.getSignedDownloadUrl({ key: 'a/b.png', expiresIn: 999999 })
      )
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

    it('signs for the presign endpoint, never for the public base', async () => {
      const provider = makeProvider({
        endpoint: 'https://internal.example.com:9000',
        presignEndpoint: 'https://s3.example.com',
        forcePathStyle: true,
        bucket: 'media',
      })
      const url = new URL(await provider.getSignedDownloadUrl({ key: 'docs/a.pdf' }))
      expect(url.origin).toBe('https://s3.example.com')
      expect(url.pathname).toBe('/media/docs/a.pdf')
    })

    it('signs against the bucket that owns the key', async () => {
      const provider = makeProvider({
        endpoint: 'https://s3.example.com',
        forcePathStyle: true,
        bucket: 'private-bucket',
        publicBucket: 'public-bucket',
      })
      expect(new URL(await provider.getSignedDownloadUrl({ key: 'public/a.webp' })).pathname).toBe(
        '/public-bucket/public/a.webp'
      )
      expect(new URL(await provider.getSignedDownloadUrl({ key: 'docs/a.pdf' })).pathname).toBe(
        '/private-bucket/docs/a.pdf'
      )
    })

    it('does not add a checksum to a presigned PUT (providers answer 400 otherwise)', async () => {
      const provider = makeProvider({ endpoint: 'https://s3.example.com' })
      const url = new URL(
        await provider.getSignedUploadUrl({ key: 'quarantine/a.bin', contentType: 'text/plain' })
      )
      const names = [...url.searchParams.keys()].map((name) => name.toLowerCase())
      expect(names.some((name) => name.includes('checksum'))).toBe(false)
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    })
  })

  describe('getPublicUrl', () => {
    it('api mode builds the route address, not a bucket-root address', () => {
      const provider = makeProvider({
        publicDelivery: 'api',
        publicBaseUrl: 'https://api.example.com/api/v1/storage/public/',
      })
      expect(provider.getPublicUrl('public/avatars/u1/v-1/a b.webp')).toBe(
        'https://api.example.com/api/v1/storage/public?key=public%2Favatars%2Fu1%2Fv-1%2Fa%20b.webp'
      )
      expect(() => provider.getPublicUrl('avatars/u1/original')).toThrow(InvalidObjectKeyError)
    })

    it('joins the public base and the key, independent of the SDK endpoint', () => {
      const provider = makeProvider({ endpoint: 'https://internal:9000', bucket: 'media' })
      expect(provider.getPublicUrl('public/avatars/u1/a.webp')).toBe(
        'https://cdn.example.com/public/avatars/u1/a.webp'
      )
    })

    it('keeps a path in the base and ignores trailing slashes', () => {
      const provider = makeProvider({ publicBaseUrl: 'https://global.s3.cloud.ru/my-bucket//' })
      expect(provider.getPublicUrl('public/a.webp')).toBe(
        'https://global.s3.cloud.ru/my-bucket/public/a.webp'
      )
    })

    it('percent-encodes every segment but keeps the separators', () => {
      expect(makeProvider().getPublicUrl('public/my file/a+b#1.webp')).toBe(
        'https://cdn.example.com/public/my%20file/a%2Bb%231.webp'
      )
    })

    it('refuses a private key', () => {
      expect(() => makeProvider().getPublicUrl('avatars/u1/original')).toThrow(
        InvalidObjectKeyError
      )
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
