import {
  type S3StorageConfig,
  S3StorageProvider,
} from '../src/infrastructure/storage/providers/s3-storage.provider'
import { runStorageProviderContract } from '../src/infrastructure/storage/storage.contract-spec'

import {
  anonymousGet,
  type GarageBackend,
  type S3Backend,
  startGarage,
  startSeaweedFs,
} from './support/s3-backends'

// The real S3 wire protocol against two pinned emulators. They prove addressing, multipart,
// copy, presigning and how a published location behaves. They do not prove provider policy
// semantics, and neither enforces object ACLs, so `acl` mode is never claimed proven here.

const bytes = Buffer.from('wire-bytes')
const PROBE_PRIVATE = '__amcore_probes__/private-canary'

function providerFor(
  backend: S3Backend,
  config: Pick<S3StorageConfig, 'bucket' | 'publicBaseUrl'> & Partial<S3StorageConfig>
): S3StorageProvider {
  return new S3StorageProvider({
    region: backend.region,
    accessKeyId: backend.accessKeyId,
    secretAccessKey: backend.secretAccessKey,
    endpoint: backend.endpoint,
    forcePathStyle: true,
    signedUrlDefaultTtl: 3600,
    signedUrlMaxTtl: 604800,
    ...config,
  })
}

describe('S3 storage over the wire (SeaweedFS)', () => {
  let seaweed: S3Backend
  let contractBucketReady = false

  beforeAll(async () => {
    seaweed = await startSeaweedFs([
      // Published location: only the public/ prefix of one bucket, read-only, anonymous.
      // `wire-exposed` models a private bucket that was opened to everyone by mistake.
      { name: 'anonymous', actions: ['Read:wire-public/public/*', 'Read:wire-exposed'] },
    ])
  }, 120_000)

  afterAll(async () => {
    await seaweed?.stop()
  })

  runStorageProviderContract(
    'SeaweedFS, one bucket',
    async () => {
      // One bucket for the whole contract, emptied before each test: SeaweedFS allocates a
      // volume group per bucket, so a bucket per test would exhaust it.
      const bucket = 'wire-contract'
      if (!contractBucketReady) {
        await seaweed.createBucket(bucket)
        contractBucketReady = true
      }
      await seaweed.emptyBucket(bucket)
      return providerFor(seaweed, { bucket, publicBaseUrl: `${seaweed.endpoint}/${bucket}` })
    },
    { signedUrls: true, publicUrls: true }
  )

  describe('publication', () => {
    it('serves keys under public/ anonymously and nothing else (external mode)', async () => {
      await seaweed.createBucket('wire-public')
      const provider = providerFor(seaweed, {
        bucket: 'wire-public',
        publicBaseUrl: `${seaweed.endpoint}/wire-public`,
      })
      await provider.upload({ key: 'public/avatars/u1/v-1/avatar-256.webp', body: bytes })
      await provider.upload({ key: 'avatars/u1/v-1/original', body: Buffer.from('secret') })

      const published = await anonymousGet(
        provider.getPublicUrl('public/avatars/u1/v-1/avatar-256.webp')
      )
      expect(published.status).toBe(200)
      expect(published.body.equals(bytes)).toBe(true)

      const original = await anonymousGet(`${seaweed.endpoint}/wire-public/avatars/u1/v-1/original`)
      expect(original.status).toBe(403)
    })

    it('accepts the ACL header in acl mode and still serves nothing (ignored by this server)', async () => {
      await seaweed.createBucket('wire-acl')
      const provider = providerFor(seaweed, {
        bucket: 'wire-acl',
        publicBaseUrl: `${seaweed.endpoint}/wire-acl`,
        publicDelivery: 'acl',
      })
      await provider.upload({ key: 'public/avatars/u1/a.webp', body: bytes })
      expect((await provider.getMetadata('public/avatars/u1/a.webp')).visibility).toBe(
        'public-read'
      )
      const response = await anonymousGet(provider.getPublicUrl('public/avatars/u1/a.webp'))
      // The upload succeeded, so only a delivery check can tell this setup is not public.
      expect(response.status).toBe(403)
    })

    it('shows the unsigned S3 API read that tells an open private bucket from a closed one', async () => {
      await seaweed.createBucket('wire-exposed')
      await seaweed.createBucket('wire-closed')
      const exposed = providerFor(seaweed, {
        bucket: 'wire-exposed',
        publicBaseUrl: `${seaweed.endpoint}/wire-exposed`,
      })
      const closed = providerFor(seaweed, {
        bucket: 'wire-closed',
        publicBaseUrl: `${seaweed.endpoint}/wire-closed`,
      })
      await exposed.upload({ key: PROBE_PRIVATE, body: bytes })
      await closed.upload({ key: PROBE_PRIVATE, body: bytes })

      const open = await anonymousGet(`${seaweed.endpoint}/wire-exposed/${PROBE_PRIVATE}`)
      const denied = await anonymousGet(`${seaweed.endpoint}/wire-closed/${PROBE_PRIVATE}`)
      expect(open.status).toBe(200)
      expect(open.body.equals(bytes)).toBe(true)
      expect([401, 403]).toContain(denied.status)
    })
  })

  describe('presigned URLs', () => {
    it('downloads a private object and accepts an upload through presigned URLs', async () => {
      await seaweed.createBucket('wire-presign')
      const provider = providerFor(seaweed, {
        bucket: 'wire-presign',
        publicBaseUrl: `${seaweed.endpoint}/wire-presign`,
      })
      await provider.upload({ key: 'docs/report.pdf', body: bytes })

      const downloadUrl = await provider.getSignedDownloadUrl({ key: 'docs/report.pdf' })
      const download = await fetch(downloadUrl)
      expect(download.status).toBe(200)
      expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true)

      const uploadUrl = await provider.getSignedUploadUrl({
        key: 'quarantine/u1/upload.bin',
        contentType: 'application/octet-stream',
      })
      const upload = await fetch(uploadUrl, { method: 'PUT', body: 'uploaded' })
      expect(upload.status).toBe(200)
      expect((await provider.download('quarantine/u1/upload.bin')).toString()).toBe('uploaded')
    })
  })
})

describe('S3 storage over the wire (Garage)', () => {
  let garage: GarageBackend
  let contractBucketsReady = false

  beforeAll(async () => {
    garage = await startGarage()
  }, 120_000)

  afterAll(async () => {
    await garage?.stop()
  })

  const twoBuckets = async (
    prefix: string,
    overrides: Partial<S3StorageConfig> = {}
  ): Promise<{ provider: S3StorageProvider; privateBucket: string; publicBucket: string }> => {
    const privateBucket = `${prefix}-private`
    const publicBucket = `${prefix}-public`
    await garage.createBucket(privateBucket)
    await garage.createBucket(publicBucket, { website: true })
    const provider = providerFor(garage, {
      bucket: privateBucket,
      publicBucket,
      publicBaseUrl: garage.webBase(publicBucket),
      ...overrides,
    })
    return { provider, privateBucket, publicBucket }
  }

  runStorageProviderContract(
    'Garage, two buckets',
    async () => {
      const prefix = 'contract'
      if (!contractBucketsReady) {
        await garage.createBucket(`${prefix}-private`)
        await garage.createBucket(`${prefix}-public`, { website: true })
        contractBucketsReady = true
      }
      await garage.emptyBucket(`${prefix}-private`)
      await garage.emptyBucket(`${prefix}-public`)
      return providerFor(garage, {
        bucket: `${prefix}-private`,
        publicBucket: `${prefix}-public`,
        publicBaseUrl: garage.webBase(`${prefix}-public`),
      })
    },
    { signedUrls: true, publicUrls: true, separateNamespaces: true }
  )

  describe('publication', () => {
    it('publishes the whole public bucket and keeps the private bucket out of the web endpoint', async () => {
      const { provider, publicBucket } = await twoBuckets('publish')
      await provider.upload({ key: 'public/avatars/u1/v-1/avatar-256.webp', body: bytes })
      await provider.upload({ key: 'avatars/u1/v-1/original', body: Buffer.from('secret') })

      const url = provider.getPublicUrl('public/avatars/u1/v-1/avatar-256.webp')
      expect(url).toBe(`${garage.webBase(publicBucket)}/public/avatars/u1/v-1/avatar-256.webp`)
      const published = await garage.webGet(publicBucket, 'public/avatars/u1/v-1/avatar-256.webp')
      expect(published.status).toBe(200)
      expect(published.body.equals(bytes)).toBe(true)

      // The original lives in the private bucket, so the public web endpoint does not have it.
      const original = await garage.webGet(publicBucket, 'avatars/u1/v-1/original')
      expect(original.status).toBe(404)
    })

    it('reads a private canary through the unsigned S3 API as denied, while the website would serve a misplaced one', async () => {
      const { provider, privateBucket, publicBucket } = await twoBuckets('leak')
      await provider.upload({ key: PROBE_PRIVATE, body: bytes })

      // Correct check target: the private bucket through the S3 API without credentials.
      const unsigned = await anonymousGet(`${garage.endpoint}/${privateBucket}/${PROBE_PRIVATE}`)
      expect([401, 403]).toContain(unsigned.status)

      // Why the check must not look at the public base alone: a private-class key that was
      // written into a website bucket is served, because the website publishes the whole bucket.
      const misplaced = providerFor(garage, {
        bucket: publicBucket,
        publicBaseUrl: garage.webBase(publicBucket),
      })
      await misplaced.upload({ key: PROBE_PRIVATE, body: bytes })
      const exposed = await garage.webGet(publicBucket, PROBE_PRIVATE)
      expect(exposed.status).toBe(200)
    })
  })

  describe('copy and delete across two buckets', () => {
    it('keeps each namespace in its own bucket', async () => {
      const { provider, privateBucket } = await twoBuckets('bucketing')
      await provider.upload({ key: 'public/x/a.webp', body: bytes })
      await provider.copy({ source: 'public/x/a.webp', destination: 'public/x/b.webp' })
      await provider.upload({ key: 'x/private.bin', body: bytes })
      await provider.deleteMany(['public/x/a.webp', 'x/private.bin'])
      expect(await provider.exists('public/x/a.webp')).toBe(false)
      expect(await provider.exists('public/x/b.webp')).toBe(true)
      // The private bucket never received the public copy.
      const privateOnly = providerFor(garage, {
        bucket: privateBucket,
        publicBucket: privateBucket,
        publicBaseUrl: 'https://unused.example.com',
      })
      expect(await privateOnly.exists('public/x/b.webp')).toBe(false)
    })
  })
})
