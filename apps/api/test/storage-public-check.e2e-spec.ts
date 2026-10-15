import { jest } from '@jest/globals'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../src/env/env.service'
import type { MetricsService } from '../src/infrastructure/observability'
import {
  type S3StorageConfig,
  S3StorageProvider,
} from '../src/infrastructure/storage/providers/s3-storage.provider'
import { StorageService } from '../src/infrastructure/storage/storage.service'
import { runStorageCheck } from '../src/infrastructure/storage/storage-check.runner'
import { StoragePublicController } from '../src/infrastructure/storage/storage-public.controller'
import { StoragePublicCheckService } from '../src/infrastructure/storage/storage-public-check.service'

import {
  anonymousGet,
  type GarageBackend,
  garageRead,
  type S3Backend,
  startGarage,
  startSeaweedFs,
} from './support/s3-backends'

// The public-delivery check and the operator command against real S3 servers. Emulators prove
// the request shapes and the exposed/closed observation; provider policy semantics and object
// ACL enforcement stay unproven here (neither server enforces ACLs).

const PREFIX = '__amcore_probes__'
const bytesOf = (text: string): Buffer => Buffer.from(text)

type Read = (url: string) => Promise<{ status: number; body: Buffer }>

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

function serviceFor(
  provider: S3StorageProvider,
  config: {
    bucket: string
    publicBucket?: string
    publicBaseUrl: string
    delivery?: 'external' | 'acl' | 'api'
  },
  read: Read
): StoragePublicCheckService {
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 's3',
    STORAGE_PUBLIC_DELIVERY: config.delivery ?? 'external',
    STORAGE_PUBLIC_CHECK_ENABLED: true,
    STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS: 3600,
    STORAGE_PUBLIC_CHECK_TIMEOUT_SECONDS: 10,
    STORAGE_PROBE_PREFIX: PREFIX,
    STORAGE_BUCKET: config.bucket,
    STORAGE_PUBLIC_BUCKET: config.publicBucket,
    STORAGE_PUBLIC_BASE_URL: config.publicBaseUrl,
  }
  return new StoragePublicCheckService(
    provider,
    { get: (key: string) => values[key] } as unknown as EnvService,
    { registerGauge: jest.fn() } as unknown as MetricsService,
    { warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger,
    (url) => read(url)
  )
}

const checkDeps = (
  provider: S3StorageProvider,
  base: string,
  singleBucket: boolean,
  read: Read
) => ({
  provider,
  read: (url: string) => read(url),
  send: async (url: string, init: { method: 'GET' | 'PUT'; body?: Buffer }) =>
    (
      await fetch(url, {
        method: init.method,
        body: init.body ? new Uint8Array(init.body) : undefined,
      })
    ).status,
  fetchBody: async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer()),
  publicBaseUrl: base,
  urlForm: 'bucket-root' as const,
  singleBucket,
  probePrefix: PREFIX,
})

describe('public delivery check over the wire (SeaweedFS)', () => {
  let seaweed: S3Backend
  const toStop: StoragePublicCheckService[] = []

  beforeAll(async () => {
    seaweed = await startSeaweedFs([
      {
        name: 'anonymous',
        actions: ['Read:chk-prefix/public/*', 'Read:chk-exposed', 'Read:chk-heal/public/*'],
      },
    ])
  }, 120_000)

  afterAll(async () => {
    toStop.forEach((service) => service.onModuleDestroy())
    await seaweed?.stop()
  })

  const single = async (
    bucket: string,
    overrides: Partial<S3StorageConfig> = {}
  ): Promise<{ provider: S3StorageProvider; service: StoragePublicCheckService; base: string }> => {
    await seaweed.createBucket(bucket)
    const base = `${seaweed.endpoint}/${bucket}`
    const provider = providerFor(seaweed, { bucket, publicBaseUrl: base, ...overrides })
    const service = serviceFor(provider, { bucket, publicBaseUrl: base }, anonymousGet)
    toStop.push(service)
    return { provider, service, base }
  }

  it('is healthy when only the public/ prefix is published', async () => {
    const { service } = await single('chk-prefix')
    await service.boot()
    expect(service.snapshot()).toMatchObject({ state: 'healthy', failure: null })
  })

  it('reports a private bucket that is open to everyone', async () => {
    const { service } = await single('chk-exposed')
    await service.boot()
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      stage: 'private_exposed_api',
      failure: 'private_exposed',
    })
  })

  it('reports acl mode on a server that accepts the header and ignores it', async () => {
    const { service } = await single('chk-acl', { publicDelivery: 'acl' })
    await service.boot()
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      stage: 'public_read',
      failure: 'public_not_served',
    })
  })

  it('repairs a deleted canary instead of reporting it', async () => {
    const { provider, service } = await single('chk-heal')
    await service.boot()
    await provider.delete(`public/${PREFIX}/public-canary`)
    await service.run()
    expect(service.snapshot()).toMatchObject({ state: 'healthy', failure: null })
  })

  it('passes every step of the operator command on a correct setup', async () => {
    await seaweed.createBucket('chk-prefix').catch(() => undefined) // already there when run in order
    const base = `${seaweed.endpoint}/chk-prefix`
    const provider = providerFor(seaweed, { bucket: 'chk-prefix', publicBaseUrl: base })
    const steps = await runStorageCheck(checkDeps(provider, base, true, anonymousGet))
    expect(steps.filter((s) => s.status === 'failed')).toEqual([])
    expect(steps.every((s) => s.status === 'ok')).toBe(true)
  }, 90_000)
})

describe('public delivery check over the wire (Garage)', () => {
  let garage: GarageBackend
  let read: Read
  const toStop: StoragePublicCheckService[] = []

  beforeAll(async () => {
    garage = await startGarage()
    read = garageRead(garage)
  }, 120_000)

  afterAll(async () => {
    toStop.forEach((service) => service.onModuleDestroy())
    await garage?.stop()
  })

  it('is healthy with a private bucket and a website bucket', async () => {
    await garage.createBucket('chk-private')
    await garage.createBucket('chk-public', { website: true })
    const base = garage.webBase('chk-public')
    const provider = providerFor(garage, {
      bucket: 'chk-private',
      publicBucket: 'chk-public',
      publicBaseUrl: base,
    })
    const service = serviceFor(
      provider,
      { bucket: 'chk-private', publicBucket: 'chk-public', publicBaseUrl: base },
      read
    )
    toStop.push(service)
    await service.boot()
    expect(service.snapshot()).toMatchObject({ state: 'healthy', failure: null })
  })

  it('reports private canaries published by a website bucket that holds both namespaces', async () => {
    await garage.createBucket('chk-both', { website: true })
    const base = garage.webBase('chk-both')
    const provider = providerFor(garage, { bucket: 'chk-both', publicBaseUrl: base })
    const service = serviceFor(provider, { bucket: 'chk-both', publicBaseUrl: base }, read)
    toStop.push(service)
    await service.boot()
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      stage: 'private_exposed_base',
      failure: 'private_exposed',
    })
  })

  it('passes every step of the operator command on two buckets', async () => {
    const base = garage.webBase('chk-public')
    const provider = providerFor(garage, {
      bucket: 'chk-private',
      publicBucket: 'chk-public',
      publicBaseUrl: base,
    })
    const steps = await runStorageCheck(checkDeps(provider, base, false, read))
    expect(steps.filter((s) => s.status === 'failed')).toEqual([])
    expect(steps.every((s) => s.status === 'ok')).toBe(true)
  }, 90_000)
})

describe('api delivery mode over the wire (SeaweedFS behind the real public route)', () => {
  let seaweed: S3Backend
  let app: NestFastifyApplication
  let service: StoragePublicCheckService | undefined
  let provider: S3StorageProvider
  let base: string

  beforeAll(async () => {
    // No anonymous identity: the bucket stays closed to the world, the API reads it.
    seaweed = await startSeaweedFs()
    await seaweed.createBucket('api-mode')
    const env = { STORAGE_DRIVER: 's3', STORAGE_PUBLIC_DELIVERY: 'api' }
    // The route needs only reads; the public base (which depends on the port it listens on)
    // matters for the URLs the application builds, so those use a second provider below.
    const serving = providerFor(seaweed, {
      bucket: 'api-mode',
      publicBaseUrl: 'http://127.0.0.1',
      publicDelivery: 'api',
    })
    const module = await Test.createTestingModule({
      controllers: [StoragePublicController],
      providers: [
        { provide: EnvService, useValue: { get: (key: string) => env[key as keyof typeof env] } },
        { provide: StorageService, useValue: serving },
      ],
    }).compile()
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1/storage/public`
    provider = providerFor(seaweed, {
      bucket: 'api-mode',
      publicBaseUrl: base,
      publicDelivery: 'api',
    })
  }, 120_000)

  afterAll(async () => {
    service?.onModuleDestroy()
    await app?.close()
    await seaweed?.stop()
  })

  it('serves a public key with the stored cache policy while the bucket itself stays closed', async () => {
    await provider.upload({
      key: 'public/avatars/u1/v-1-a/avatar-256.webp',
      body: bytesOf('image'),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    })
    const url = provider.getPublicUrl('public/avatars/u1/v-1-a/avatar-256.webp')
    expect(url).toBe(`${base}?key=public%2Favatars%2Fu1%2Fv-1-a%2Favatar-256.webp`)
    const served = await fetch(url)
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer()).equals(bytesOf('image'))).toBe(true)
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(served.headers.get('content-type')).toBe('image/webp')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')

    const direct = await anonymousGet(
      `${seaweed.endpoint}/api-mode/public/avatars/u1/v-1-a/avatar-256.webp`
    )
    expect([401, 403]).toContain(direct.status)
  })

  it('refuses a private key through the route', async () => {
    await provider.upload({ key: 'avatars/u1/v-1-a/original', body: bytesOf('secret') })
    for (const key of ['avatars/u1/v-1-a/original', 'public/../avatars/u1/v-1-a/original']) {
      const response = await fetch(`${base}?key=${encodeURIComponent(key)}`)
      expect(response.status).toBe(404)
      expect((await response.text()).includes('secret')).toBe(false)
    }
  })

  it('is healthy for the public delivery check, which reads through the real route', async () => {
    service = serviceFor(
      provider,
      { bucket: 'api-mode', publicBaseUrl: base, delivery: 'api' },
      anonymousGet
    )
    await service.boot()
    expect(service.snapshot()).toMatchObject({
      state: 'healthy',
      delivery: 'api',
      layout: 'one',
      failure: null,
    })
  })

  it('passes every step of the operator command in api mode', async () => {
    const steps = await runStorageCheck({
      ...checkDeps(provider, base, true, anonymousGet),
      urlForm: 'route',
    })
    expect(steps.filter((s) => s.status === 'failed')).toEqual([])
    expect(steps.every((s) => s.status === 'ok')).toBe(true)
  }, 90_000)
})
