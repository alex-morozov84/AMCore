import { CreateBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { jest } from '@jest/globals'
import type { PinoLogger } from 'nestjs-pino'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

import type { EnvService } from '../src/env/env.service'
import type { MetricsService } from '../src/infrastructure/observability'
import { StorageProbeIo } from '../src/infrastructure/storage/storage-probe.io'
import { StorageProbeService } from '../src/infrastructure/storage/storage-probe.service'

// Test-only S3-compatible implementation, not an application runtime dependency.
const IMAGE =
  'chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d'
const bucket = 't023-canary'
const secret = 'test-secret-not-real'
const identities = [
  {
    name: 'admin',
    credentials: [{ accessKey: 'test-admin', secretKey: secret }],
    actions: ['Admin', 'Read', 'Write', 'List'],
  },
  {
    name: 'probe',
    credentials: [{ accessKey: 'test-probe', secretKey: secret }],
    actions: [`Read:${bucket}/allowed/*`, `Write:${bucket}/allowed/*`],
  },
  {
    name: 'reader',
    credentials: [{ accessKey: 'test-reader', secretKey: secret }],
    actions: [`Read:${bucket}/allowed/*`],
  },
  {
    name: 'writer',
    credentials: [{ accessKey: 'test-writer', secretKey: secret }],
    actions: [`Write:${bucket}/allowed/*`],
  },
]

describe('active probe against isolated S3-compatible storage', () => {
  let container: StartedTestContainer
  let admin: S3Client
  let endpoint: string
  const ios: StorageProbeIo[] = []
  beforeAll(async () => {
    container = await new GenericContainer(IMAGE)
      .withCommand([
        'server',
        '-s3',
        '-s3.config=/etc/s3.json',
        '-master.volumeSizeLimitMB=16',
        '-volume.max=1',
        '-ip=127.0.0.1',
        '-ip.bind=0.0.0.0',
      ])
      .withCopyContentToContainer([
        { content: JSON.stringify({ identities }), target: '/etc/s3.json' },
      ])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forHttp('/', 8333).forStatusCode(403))
      .withStartupTimeout(60000)
      .start()
    endpoint = `http://${container.getHost()}:${container.getMappedPort(8333)}`
    admin = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test-admin', secretAccessKey: secret },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    await admin.send(new CreateBucketCommand({ Bucket: bucket }))
  }, 90000)
  afterAll(async () => {
    for (const io of ios) io.destroy()
    admin?.destroy()
    await container?.stop()
  })

  function probe(accessKey: string): StorageProbeService {
    const values: Record<string, unknown> = {
      STORAGE_DRIVER: 's3',
      STORAGE_REGION: 'us-east-1',
      STORAGE_ENDPOINT: endpoint,
      STORAGE_BUCKET: bucket,
      STORAGE_ACCESS_KEY_ID: accessKey,
      STORAGE_SECRET_ACCESS_KEY: secret,
      STORAGE_FORCE_PATH_STYLE: true,
      STORAGE_PROBE_PREFIX: 'allowed',
      STORAGE_PROBE_INTERVAL_SECONDS: 60,
      STORAGE_PROBE_TIMEOUT_SECONDS: 10,
    }
    const env = { get: (key: string) => values[key] } as unknown as EnvService
    const io = new StorageProbeIo(env)
    ios.push(io)
    return new StorageProbeService(
      env,
      io,
      {} as MetricsService,
      { warn: jest.fn() } as unknown as PinoLogger
    )
  }

  it('succeeds with scoped read/write permissions without ListBucket and leaves no canaries', async () => {
    const services = [probe('test-probe'), probe('test-probe')]
    await Promise.all(services.map((service) => service.run()))
    expect(services.map((service) => service.snapshot().state)).toEqual(['healthy', 'healthy'])
    const listed = await admin.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'allowed/' })
    )
    expect(listed.Contents ?? []).toEqual([])
  })

  it.each([
    ['test-reader', 'write'],
    ['test-writer', 'read'],
  ])('reports denied operations for %s', async (key, stage) => {
    const service = probe(key)
    await service.run()
    expect(service.snapshot()).toMatchObject({ state: 'failed', failure: 'access_denied', stage })
  })
})
