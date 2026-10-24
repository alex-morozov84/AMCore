import type { EnvService } from '../../../../env/env.service'
import type { MetricsService } from '../../../../infrastructure/observability'
import type { ScheduledJobExecutor } from '../../../../infrastructure/schedule/scheduled-job.executor'

import { TelegramReachabilityService } from './telegram-reachability.service'
import type { TelegramReachabilityStore, TelegramWriteOutcome } from './telegram-reachability.store'

const TOKEN = '123456:secret-token-value'

function setup(token: string | undefined = TOKEN, write: TelegramWriteOutcome = 'stored') {
  const env = {
    get: (key: string) =>
      key === 'TELEGRAM_BOT_TOKEN'
        ? token
        : key === 'TELEGRAM_API_BASE_URL'
          ? 'https://t.test'
          : undefined,
  } as unknown as EnvService
  const store = {
    open: jest.fn(),
    now: jest.fn(() => Promise.resolve(1_800_000_000_000)),
    write: jest.fn(() => Promise.resolve(write)),
    remove: jest.fn(() => Promise.resolve(true)),
    close: jest.fn(() => Promise.resolve()),
  }
  const gauges: { collect: (g: { set: jest.Mock }) => void }[] = []
  const metrics = {
    registerGauge: jest.fn((config: (typeof gauges)[number]) => gauges.push(config)),
  } as unknown as MetricsService
  const jobs = {
    run: jest.fn((_job: unknown, task: () => Promise<unknown>) => task()),
  } as unknown as ScheduledJobExecutor
  const service = new TelegramReachabilityService(
    env,
    store as unknown as TelegramReachabilityStore,
    metrics,
    jobs
  )
  service.onModuleInit()
  const metricValues = () => {
    const set = jest.fn()
    gauges[0]?.collect({ set })
    return Object.fromEntries(set.mock.calls.map(([labels, value]) => [labels.state, value]))
  }
  return { service, store, jobs, metrics, metricValues }
}

function answer(status: number, body: unknown) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

afterEach(() => jest.restoreAllMocks())

describe('TelegramReachabilityService', () => {
  it('disabled channel: no gauge, no call, no recorded run', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    const { service, jobs, metrics, store } = setup('')
    await service.scheduledCheck()
    expect(metrics.registerGauge).not.toHaveBeenCalled()
    expect(jobs.run).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(store.open).not.toHaveBeenCalled()
  })

  it('an ok check is stored and is a successful run with no codes', async () => {
    answer(200, { ok: true, result: { id: 1, is_bot: true } })
    const { service, store, metricValues } = setup()
    expect(metricValues()).toMatchObject({ none: 1, ok: 0 })
    await expect(service.runOnce()).resolves.toEqual({
      outcome: 'success',
      summary: { counts: {}, codes: [] },
    })
    const [, stored] = store.write.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(stored).toMatchObject({ v: 1, seq: 1, result: 'ok', failure: null })
    expect(stored.binding).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(TOKEN)
    expect(metricValues()).toMatchObject({ ok: 1, none: 0, failed: 0, stale: 0, unknown: 0 })
  })

  it('a stored Telegram failure is still a successful run that names the observed code', async () => {
    answer(401, { ok: false })
    const { service, metricValues } = setup()
    await expect(service.runOnce()).resolves.toEqual({
      outcome: 'success',
      summary: { counts: {}, codes: ['auth_rejected'] },
    })
    expect(metricValues()).toMatchObject({ failed: 1 })
  })

  it.each([
    ['late', 'store_late'],
    ['overflow', 'store_overflow'],
    ['unavailable', 'store_unavailable'],
  ] as const)(
    'a %s write is a failed run, while the metric still shows the result',
    async (write, code) => {
      answer(200, { ok: true, result: { id: 1, is_bot: true } })
      const { service, metricValues } = setup(TOKEN, write)
      await expect(service.runOnce()).resolves.toEqual({ outcome: 'failed', code })
      expect(metricValues()).toMatchObject({ ok: 1 })
    }
  )

  it('no Redis time: the check still feeds the metric, nothing is written', async () => {
    answer(200, { ok: true, result: { id: 1, is_bot: true } })
    const { service, store, metricValues } = setup()
    store.now.mockResolvedValueOnce(undefined as unknown as number)
    await expect(service.runOnce()).resolves.toEqual({
      outcome: 'failed',
      code: 'store_unavailable',
    })
    expect(store.write).not.toHaveBeenCalled()
    expect(metricValues()).toMatchObject({ ok: 1 })
  })

  it('a second tick while one check is open is busy', async () => {
    let release!: (r: Response) => void
    jest.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((resolve) => (release = resolve)))
    const { service } = setup()
    const first = service.runOnce()
    await expect(service.runOnce()).resolves.toEqual({ skipped: 'busy' })
    release(new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true } })))
    await first
  })

  it('the metric turns stale when this worker stops updating', async () => {
    answer(200, { ok: true, result: { id: 1, is_bot: true } })
    const { service, metricValues } = setup()
    const now = jest.spyOn(performance, 'now')
    now.mockReturnValue(1_000)
    await service.runOnce()
    now.mockReturnValue(1_000 + 211_000)
    expect(metricValues()).toMatchObject({ stale: 1, ok: 0 })
  })

  it('graceful stop aborts, waits out the write window, removes its own result and closes', async () => {
    jest.useFakeTimers()
    try {
      answer(200, { ok: true, result: { id: 1, is_bot: true } })
      const { service, store } = setup()
      await service.runOnce()
      const stopping = service.onModuleDestroy()
      await jest.advanceTimersByTimeAsync(4_000)
      expect(store.remove).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(2_000)
      await stopping
      expect(store.remove).toHaveBeenCalledTimes(1)
      expect(store.close).toHaveBeenCalledTimes(1)
      await expect(service.runOnce()).resolves.toEqual({ skipped: 'shutdown' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('a stop before any write removes nothing', async () => {
    const { service, store } = setup()
    await service.onModuleDestroy()
    expect(store.remove).not.toHaveBeenCalled()
    expect(store.close).toHaveBeenCalledTimes(1)
  })
})
