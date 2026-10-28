import {
  BOUNDED_REDIS_CAPACITY,
  BOUNDED_REDIS_DEADLINE_MS,
  BoundedRedis,
  BoundedRedisError,
} from './bounded-redis'
import type { AppRedisClient } from './redis-connection.service'

// Unit tests use a fake client and a controlled clock: nothing here waits in real time.
// Behavior against a real server (stalled replies, reconnect) is proven in the
// bounded-redis.redis.e2e-spec.ts suite through the suite-owned TCP fixture.

type Deferred = {
  promise: Promise<string>
  resolve: (v: string) => void
  reject: (e: Error) => void
}

function deferred(): Deferred {
  let resolve!: (v: string) => void
  let reject!: (e: Error) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('BoundedRedis', () => {
  let bound: { ping: jest.Mock }
  let redis: {
    isReady: boolean
    withCommandOptions: jest.Mock
    quit: jest.Mock
    disconnect: jest.Mock
    destroy: jest.Mock
    duplicate: jest.Mock
  }
  let helper: BoundedRedis

  beforeEach(() => {
    jest.useFakeTimers()
    bound = { ping: jest.fn() }
    redis = {
      isReady: true,
      withCommandOptions: jest.fn().mockReturnValue(bound),
      quit: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      duplicate: jest.fn(),
    }
    helper = new BoundedRedis(redis as unknown as AppRedisClient)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const errorOf = async (promise: Promise<unknown>): Promise<BoundedRedisError> => {
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BoundedRedisError)
    return error as BoundedRedisError
  }

  it('returns the reply and binds the command to an abort signal', async () => {
    bound.ping.mockResolvedValue('PONG')

    await expect(helper.run((client) => client.ping())).resolves.toBe('PONG')

    expect(redis.withCommandOptions).toHaveBeenCalledWith({ abortSignal: expect.any(AbortSignal) })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('rejects before dispatch, as not_sent, when the client is not ready', async () => {
    redis.isReady = false

    const error = await errorOf(helper.run((client) => client.ping()))

    expect(error).toMatchObject({ reason: 'not_ready', outcome: 'not_sent' })
    expect(redis.withCommandOptions).not.toHaveBeenCalled()
  })

  it('reports a synchronous dispatch failure as not_sent and frees its slot', async () => {
    const error = await errorOf(
      helper.run(() => {
        throw new Error('bad arguments')
      })
    )

    expect(error).toMatchObject({ reason: 'dispatch', outcome: 'not_sent' })
    bound.ping.mockResolvedValue('PONG')
    await expect(helper.run((client) => client.ping())).resolves.toBe('PONG')
  })

  it('reports a command failure after dispatch as unknown, never as not_sent', async () => {
    bound.ping.mockRejectedValue(new Error('connection reset'))

    const error = await errorOf(helper.run((client) => client.ping()))

    expect(error).toMatchObject({ reason: 'command', outcome: 'unknown' })
    expect((error.cause as Error).message).toBe('connection reset')
  })

  it('rejects at the deadline as unknown and aborts the signal for queued commands', async () => {
    const pending = deferred()
    let signal!: AbortSignal
    const call = helper.run((_client, s) => {
      signal = s
      return pending.promise
    })
    const caught = errorOf(call)

    await jest.advanceTimersByTimeAsync(BOUNDED_REDIS_DEADLINE_MS - 1)
    expect(signal.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)

    expect(await caught).toMatchObject({ reason: 'deadline', outcome: 'unknown' })
    expect(signal.aborted).toBe(true)
  })

  it('serves a burst of exactly the capacity when every call settles promptly', async () => {
    const burst = Array.from({ length: BOUNDED_REDIS_CAPACITY }, deferred)
    const calls = burst.map((d) => helper.run(() => d.promise))

    for (const d of burst) d.resolve('ok')

    await expect(Promise.all(calls)).resolves.toHaveLength(BOUNDED_REDIS_CAPACITY)
    bound.ping.mockResolvedValue('PONG')
    await expect(helper.run((client) => client.ping())).resolves.toBe('PONG')
  })

  it('in one synchronous burst dispatches exactly the capacity and refuses the excess at once', async () => {
    // R1 regression: admission must reserve a slot before dispatch. Submit more than the
    // capacity before any deadline can fire.
    const excess = 40
    const operation = jest.fn(() => new Promise<string>(() => undefined))
    const outcomes: unknown[] = []
    Array.from({ length: BOUNDED_REDIS_CAPACITY + excess }, (_, i) =>
      helper.run(operation).catch((error: unknown) => {
        outcomes[i] = error
      })
    )

    await jest.advanceTimersByTimeAsync(0)

    expect(operation).toHaveBeenCalledTimes(BOUNDED_REDIS_CAPACITY)
    expect(outcomes.slice(0, BOUNDED_REDIS_CAPACITY).every((o) => o === undefined)).toBe(true)
    const refused = outcomes.slice(BOUNDED_REDIS_CAPACITY)
    expect(refused).toHaveLength(excess)
    for (const error of refused)
      expect(error).toMatchObject({ reason: 'capacity', outcome: 'not_sent' })
  })

  it('keeps refusing after the deadlines fire and frees one slot per actual settlement', async () => {
    const stalled = Array.from({ length: BOUNDED_REDIS_CAPACITY }, deferred)
    const calls = stalled.map((d) => errorOf(helper.run(() => d.promise)))

    await jest.advanceTimersByTimeAsync(BOUNDED_REDIS_DEADLINE_MS)
    for (const error of await Promise.all(calls)) expect(error.reason).toBe('deadline')

    // Every caller has been released, but all slots are still held by unsettled work.
    expect(await errorOf(helper.run((client) => client.ping()))).toMatchObject({
      reason: 'capacity',
      outcome: 'not_sent',
    })
    expect(bound.ping).not.toHaveBeenCalled()

    // One reply arrives late: exactly one slot frees, and exactly one new call fits.
    stalled[0]!.resolve('late')
    await jest.advanceTimersByTimeAsync(0)
    const next = deferred()
    const held = helper.run(() => next.promise)
    expect(await errorOf(helper.run((client) => client.ping()))).toMatchObject({
      reason: 'capacity',
    })
    next.resolve('ok')
    await expect(held).resolves.toBe('ok')
    bound.ping.mockResolvedValue('PONG')
    await expect(helper.run((client) => client.ping())).resolves.toBe('PONG')
  })

  it('frees a slot when stalled work settles with an error (connection closed)', async () => {
    const stalled = Array.from({ length: BOUNDED_REDIS_CAPACITY }, deferred)
    const calls = stalled.map((d) => errorOf(helper.run(() => d.promise)))
    await jest.advanceTimersByTimeAsync(BOUNDED_REDIS_DEADLINE_MS)
    await Promise.all(calls)

    for (const d of stalled) d.reject(new Error('Socket closed unexpectedly'))
    await jest.advanceTimersByTimeAsync(0)

    bound.ping.mockResolvedValue('PONG')
    await expect(helper.run((client) => client.ping())).resolves.toBe('PONG')
  })

  it('does not raise an unhandled rejection when stalled work fails after the deadline', async () => {
    // Real timers: Node reports an unhandled rejection on a later turn of the event loop.
    jest.useRealTimers()
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const pending = deferred()
    await errorOf(helper.run(() => pending.promise, 5))

    pending.reject(new Error('late failure'))
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('never retries an uncertain command', async () => {
    const pending = deferred()
    const operation = jest.fn(() => pending.promise)
    const caught = errorOf(helper.run(operation))

    await jest.advanceTimersByTimeAsync(BOUNDED_REDIS_DEADLINE_MS * 4)
    await caught

    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('never closes, disconnects, destroys or duplicates the shared client', async () => {
    const pending = deferred()
    bound.ping.mockResolvedValueOnce('PONG')
    await helper.run((client) => client.ping())
    const timedOut = errorOf(helper.run(() => pending.promise))
    await jest.advanceTimersByTimeAsync(BOUNDED_REDIS_DEADLINE_MS)
    await timedOut
    redis.isReady = false
    await errorOf(helper.run((client) => client.ping()))

    for (const method of ['quit', 'disconnect', 'destroy', 'duplicate'] as const)
      expect(redis[method]).not.toHaveBeenCalled()
  })
})
