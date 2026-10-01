import type { PinoLogger } from 'nestjs-pino'

import { StorageProbeIo } from './storage-probe.io'
import { StorageProbeService } from './storage-probe.service'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

const config = {
  STORAGE_DRIVER: 'memory',
  STORAGE_PROBE_INTERVAL_SECONDS: 60,
  STORAGE_PROBE_TIMEOUT_SECONDS: 10,
} as const
function setup() {
  const env = { get: (key: keyof typeof config) => config[key] } as unknown as EnvService
  const io = new StorageProbeIo(env)
  const metrics = { registerGauge: jest.fn() } as unknown as MetricsService
  return {
    io,
    service: new StorageProbeService(env, io, metrics, {
      warn: jest.fn(),
    } as unknown as PinoLogger),
    metrics,
  }
}

describe('independent storage transaction', () => {
  afterEach(() => jest.useRealTimers())

  it('starts unknown, checks bytes, cleans up and becomes stale', async () => {
    jest.useFakeTimers()
    const { io, service } = setup()
    const remove = jest.spyOn(io, 'remove')
    expect(service.snapshot().state).toBe('unknown')
    await service.run()
    expect(service.snapshot().state).toBe('healthy')
    expect(remove).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(180001)
    expect(service.snapshot().state).toBe('stale')
  })

  it.each(['write', 'read', 'remove'] as const)(
    'reports denied %s and recovers',
    async (operation) => {
      const { io, service } = setup()
      jest.spyOn(io, operation).mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } })
      const remove = operation === 'remove' ? io.remove : jest.spyOn(io, 'remove')
      await service.run()
      expect(service.snapshot()).toMatchObject({
        state: 'failed',
        failure: 'access_denied',
        stage: operation === 'remove' ? 'delete' : operation,
      })
      expect(remove).toHaveBeenCalledTimes(1)
      await service.run()
      expect(service.snapshot().state).toBe('healthy')
    }
  )

  it('fails corrupted reads and still deletes', async () => {
    const { io, service } = setup()
    jest.spyOn(io, 'read').mockResolvedValueOnce(Buffer.from('wrong'))
    const remove = jest.spyOn(io, 'remove')
    await service.run()
    expect(service.snapshot()).toMatchObject({ failure: 'content_mismatch', stage: 'read' })
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('publishes deadline failure without accumulating stalled I/O and cleans late writes', async () => {
    jest.useFakeTimers()
    const { io, service } = setup()
    let settle!: () => void
    const write = jest.spyOn(io, 'write').mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          settle = r
        })
    )
    const remove = jest.spyOn(io, 'remove')
    const first = service.run()
    await jest.advanceTimersByTimeAsync(10001)
    expect(service.snapshot()).toMatchObject({
      state: 'failed',
      failure: 'timeout',
      stage: 'write',
    })
    expect(service.run()).toBe(first)
    await jest.advanceTimersByTimeAsync(180001)
    expect(service.snapshot().state).toBe('stale')
    expect(write).toHaveBeenCalledTimes(1)
    settle()
    await first
    expect(remove).toHaveBeenCalledTimes(1)
    expect(service.snapshot().failure).toBe('timeout')
    await service.run()
    expect(service.snapshot().state).toBe('healthy')
  })

  it('reports scheduler time separately from result time and hides it during active I/O', async () => {
    jest.useFakeTimers()
    const { io, service } = setup()
    const start = Date.now()
    jest
      .spyOn(io, 'read')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(Buffer.from('AMCore isolated storage diagnostic\n')), 5000)
          )
      )
    service.onModuleInit()
    expect(service.snapshot()).toMatchObject({ inProgress: true, nextScheduledAt: null })
    await jest.advanceTimersByTimeAsync(5000)
    expect(service.snapshot()).toMatchObject({
      inProgress: false,
      checkedAt: new Date(start + 5000).toISOString(),
      nextScheduledAt: new Date(start + 60000).toISOString(),
    })
    await jest.advanceTimersByTimeAsync(55000)
    expect(service.snapshot().nextScheduledAt).toBe(new Date(start + 120000).toISOString())
    service.onModuleDestroy()
    expect(service.snapshot().nextScheduledAt).toBeNull()
  })

  it('reads cached state without doing I/O', async () => {
    const { io, service } = setup()
    const write = jest.spyOn(io, 'write')
    for (let i = 0; i < 1000; i++) service.snapshot()
    expect(write).not.toHaveBeenCalled()
  })
})
