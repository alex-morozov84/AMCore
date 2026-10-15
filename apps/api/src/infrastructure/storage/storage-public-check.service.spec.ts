import type { PinoLogger } from 'nestjs-pino'

import { PRIVATE_CANARY_BYTES, PUBLIC_CANARY_BYTES } from './public-delivery-check'
import type { StorageProvider } from './storage.interface'
import type { AnonymousRead, AnonymousResponse } from './storage-anonymous-read'
import { StoragePublicCheckService } from './storage-public-check.service'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

const PUBLIC_URL = 'https://cdn.example.com/public/__amcore_probes__/public-canary'
const API_URL = 'https://s3.example.com/private/__amcore_probes__/private-canary'
const BASE_URL = 'https://cdn.example.com/__amcore_probes__/private-canary'

const ok = (): AnonymousResponse => ({ status: 200, body: PUBLIC_CANARY_BYTES })
const status = (code: number): AnonymousResponse => ({ status: code, body: Buffer.alloc(0) })

interface Harness {
  service: StoragePublicCheckService
  responses: Map<string, AnonymousResponse>
  upload: jest.Mock
  exists: jest.Mock
  logger: { warn: jest.Mock; info: jest.Mock }
  gauges: Map<string, (gauge: { set: jest.Mock }) => void>
}

function build(values: Record<string, unknown> = {}): Harness {
  const env: Record<string, unknown> = {
    STORAGE_DRIVER: 's3',
    STORAGE_PUBLIC_DELIVERY: 'external',
    STORAGE_PUBLIC_CHECK_ENABLED: true,
    STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS: 3600,
    STORAGE_PUBLIC_CHECK_TIMEOUT_SECONDS: 10,
    STORAGE_BUCKET: 'private',
    STORAGE_PUBLIC_BUCKET: 'public',
    STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com',
    STORAGE_PROBE_PREFIX: '__amcore_probes__',
    ...values,
  }
  const responses = new Map<string, AnonymousResponse>([
    [PUBLIC_URL, ok()],
    [API_URL, status(403)],
    [BASE_URL, status(403)],
  ])
  const read: AnonymousRead = async (url) => {
    const response = responses.get(url)
    if (!response) throw new Error(`unexpected ${url}`)
    return response
  }
  const upload = jest.fn().mockResolvedValue({ key: 'k', size: 1 })
  const exists = jest.fn().mockResolvedValue(true)
  const provider = {
    upload,
    exists,
    getPublicUrl: () => PUBLIC_URL,
    getUnsignedObjectUrl: async () => API_URL,
  } as unknown as StorageProvider
  const gauges = new Map<string, (gauge: { set: jest.Mock }) => void>()
  const metrics = {
    registerGauge: jest.fn((config: { name: string; collect: (gauge: never) => void }) => {
      gauges.set(config.name, config.collect as never)
    }),
  } as unknown as MetricsService
  const logger = { warn: jest.fn(), info: jest.fn() }
  const service = new StoragePublicCheckService(
    provider,
    { get: (key: string) => env[key] } as unknown as EnvService,
    metrics,
    logger as unknown as PinoLogger,
    read
  )
  return { service, responses, upload, exists, logger, gauges }
}

describe('StoragePublicCheckService', () => {
  let active: StoragePublicCheckService | undefined
  afterEach(() => active?.onModuleDestroy())
  const start = (values?: Record<string, unknown>): Harness => {
    const harness = build(values)
    active = harness.service
    return harness
  }

  it.each([
    [{ STORAGE_DRIVER: 'local' }],
    [{ STORAGE_DRIVER: 'memory' }],
    [{ STORAGE_PUBLIC_CHECK_ENABLED: false }],
    [{ PROCESS_ROLE: 'worker' }],
  ])('does nothing when it does not apply (%j)', (values) => {
    const { service, upload, gauges } = start(values)
    service.onModuleInit()
    expect(service.enabled).toBe(false)
    expect(upload).not.toHaveBeenCalled()
    expect(gauges.size).toBe(0)
  })

  it('writes the canaries once, then reports healthy and only reads afterwards', async () => {
    const { service, upload } = start()
    await service.boot()
    expect(upload.mock.calls.map((call) => call[0].key)).toEqual([
      'public/__amcore_probes__/public-canary',
      '__amcore_probes__/private-canary',
    ])
    expect(service.snapshot()).toMatchObject({ state: 'healthy', stage: null, failure: null })
    await service.run()
    await service.run()
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('is unknown before the first result', () => {
    expect(start().service.snapshot()).toMatchObject({ state: 'unknown', checkedAt: null })
  })

  it('reports an unpublished location and logs once, then logs the recovery', async () => {
    const { service, responses, logger } = start()
    await service.boot()
    responses.set(PUBLIC_URL, status(403))
    await service.run()
    await service.run()
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      stage: 'public_read',
      failure: 'public_not_served',
    })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'storage_public_check_failed', status: 403 })
    )
    responses.set(PUBLIC_URL, ok())
    await service.run()
    expect(service.snapshot().state).toBe('healthy')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'storage_public_check_recovered' })
    )
  })

  it('repairs a missing canary and judges again before reporting', async () => {
    const { service, responses, upload } = start()
    await service.boot()
    upload.mockClear()
    let served = 0
    responses.set(PUBLIC_URL, status(404))
    upload.mockImplementation(async () => {
      served += 1
      responses.set(PUBLIC_URL, ok())
      return { key: 'k', size: 1 }
    })
    await service.run()
    expect(served).toBe(2)
    expect(service.snapshot().state).toBe('healthy')
  })

  it('restores a removed private canary so an anonymous 404 cannot hide an exposure', async () => {
    const { service, responses, upload, exists } = start()
    await service.boot()
    upload.mockClear()
    // A lifecycle rule removed the private canary; an exposed bucket would now answer 404.
    exists.mockResolvedValueOnce(false)
    responses.set(API_URL, status(404))
    upload.mockImplementation(async (input: { key: string }) => {
      if (input.key.endsWith('private-canary')) responses.set(API_URL, status(200))
      return { key: input.key, size: 1 }
    })
    await service.run()
    expect(exists).toHaveBeenLastCalledWith('__amcore_probes__/private-canary')
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: '__amcore_probes__/private-canary' })
    )
    expect(service.snapshot()).toMatchObject({ state: 'failed', failure: 'private_exposed' })
  })

  it('exposes the private canary as a failure and as the exposure gauge', async () => {
    const { service, responses, gauges } = start({ STORAGE_PUBLIC_BUCKET: undefined })
    service.onModuleInit()
    await service.boot()
    responses.set(BASE_URL, { status: 200, body: PRIVATE_CANARY_BYTES })
    await service.run()
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      stage: 'private_exposed_base',
      failure: 'private_exposed',
    })
    const exposed = { set: jest.fn() }
    gauges.get('amcore_storage_private_exposed')?.(exposed)
    expect(exposed.set).toHaveBeenCalledWith({ driver: 's3' }, 1)
    const state = { set: jest.fn() }
    gauges.get('amcore_storage_public_check_state')?.(state)
    expect(state.set).toHaveBeenCalledWith({ driver: 's3', state: 'failed' }, 1)
    expect(state.set).toHaveBeenCalledWith({ driver: 's3', state: 'healthy' }, 0)
  })

  it('becomes stale after three missed intervals', async () => {
    const { service } = start()
    await service.boot()
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now + 3 * 3600 * 1000 + 1)
    expect(service.snapshot().state).toBe('stale')
    jest.restoreAllMocks()
  })

  it('does not let two checks overlap', async () => {
    const { service, responses } = start()
    await service.boot()
    let reads = 0
    responses.set(PUBLIC_URL, ok())
    const original = responses.get.bind(responses)
    responses.get = (url: string) => {
      reads += 1
      return original(url)
    }
    await Promise.all([service.run(), service.run(), service.run()])
    expect(reads).toBe(2) // one check: the public canary and the unsigned private canary
  })

  it('reports a setup failure when the canaries cannot be written, then the real result', async () => {
    const { service, upload, logger } = start()
    upload.mockRejectedValue(new Error('read-only credentials'))
    await service.boot()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'setup', failure: 'check_error' })
    )
    expect(service.snapshot().state).toBe('healthy') // the canaries already existed
  })

  describe('snapshot for the Console', () => {
    it('reports the delivery configuration without bucket names or endpoints', async () => {
      const { service } = start()
      await service.boot()
      expect(service.snapshot()).toEqual({
        driver: 's3',
        state: 'healthy',
        offReason: null,
        delivery: 'external',
        layout: 'two',
        publicBaseUrl: 'https://cdn.example.com',
        checkedAt: expect.any(String),
        stage: null,
        failure: null,
      })
      expect(JSON.stringify(service.snapshot())).not.toMatch(/private|public"|s3\.example/)
    })

    it('reports one bucket when the public bucket is unset or equal to the private one', () => {
      expect(start({ STORAGE_PUBLIC_BUCKET: undefined }).service.snapshot().layout).toBe('one')
      expect(start({ STORAGE_PUBLIC_BUCKET: 'private' }).service.snapshot().layout).toBe('one')
    })

    it.each([
      [{ STORAGE_DRIVER: 'local' }, 'local_driver'],
      [{ STORAGE_DRIVER: 'memory' }, 'memory_driver'],
      [{ STORAGE_PUBLIC_CHECK_ENABLED: false }, 'disabled'],
      [{ PROCESS_ROLE: 'worker' }, 'worker_process'],
    ])('says why it is off (%j)', (values, reason) => {
      expect(start(values).service.snapshot()).toMatchObject({
        state: 'off',
        offReason: reason,
        checkedAt: null,
        stage: null,
        failure: null,
      })
    })

    it('keeps the mode and the base visible when the check is off', () => {
      expect(
        start({
          STORAGE_PUBLIC_DELIVERY: 'api',
          STORAGE_PUBLIC_CHECK_ENABLED: false,
        }).service.snapshot()
      ).toMatchObject({ delivery: 'api', publicBaseUrl: 'https://cdn.example.com' })
    })
  })

  describe('api mode', () => {
    it('asks the route for the private canary in the route form, whatever the bucket layout', async () => {
      const routePrivate = 'https://cdn.example.com?key=__amcore_probes__%2Fprivate-canary'
      const { service, responses } = start({ STORAGE_PUBLIC_DELIVERY: 'api' })
      responses.set(routePrivate, { status: 200, body: PRIVATE_CANARY_BYTES })
      await service.boot()
      expect(service.snapshot()).toMatchObject({
        state: 'failed',
        stage: 'private_exposed_base',
        failure: 'private_exposed',
        delivery: 'api',
      })
    })

    it('is healthy when the route refuses the private canary', async () => {
      const { service, responses } = start({ STORAGE_PUBLIC_DELIVERY: 'api' })
      responses.set('https://cdn.example.com?key=__amcore_probes__%2Fprivate-canary', status(404))
      await service.boot()
      expect(service.snapshot()).toMatchObject({ state: 'healthy', delivery: 'api' })
    })
  })
})
