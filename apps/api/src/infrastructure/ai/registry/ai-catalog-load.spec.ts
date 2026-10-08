import { AiCatalogLoad } from './ai-catalog-load'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('detachable catalogue single-flight', () => {
  afterEach(() => jest.useRealTimers())

  it('shares one physical load, bounds waiters, and retains slot after logical failure', async () => {
    jest.useFakeTimers()
    const result = deferred<string>()
    const physical = deferred<void>()
    const start = jest.fn(() => ({ result: result.promise, physicalCompletion: physical.promise }))
    const load = new AiCatalogLoad(start)
    const waiters = Array.from({ length: 64 }, () => load.load().catch(() => 'unavailable'))
    await expect(load.load()).rejects.toThrow('catalogue_unavailable')
    result.reject(new Error('maxWait'))
    await Promise.all(waiters)
    for (let i = 0; i < 3; i++) {
      const next = load.load().catch(() => 'unavailable')
      await jest.advanceTimersByTimeAsync(2001)
      expect(await next).toBe('unavailable')
    }
    expect(start).toHaveBeenCalledTimes(1)
    physical.resolve()
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1) // No settle-owned retry.
    load.close()
  })

  it('initiator abort detaches it while a healthy follower owns continuation', async () => {
    const result = deferred<string>()
    const physical = deferred<void>()
    let query!: () => void
    const load = new AiCatalogLoad((canQuery) => {
      query = canQuery
      return { result: result.promise, physicalCompletion: physical.promise }
    })
    const initiator = new AbortController()
    const first = load.load(initiator.signal, 'token')
    const follower = load.load(undefined, 'later-token')
    initiator.abort()
    await expect(first).rejects.toBeDefined()
    expect(query).not.toThrow()
    result.resolve('healthy')
    await Promise.resolve()
    physical.resolve()
    expect(await follower).toBe('healthy')
    expect(load.reserveFill()).toBe('token') // Token predates the physical load, never follower's later probe.
    expect(load.reserveFill()).toBeNull()
  })

  it.each(['gone', 'invalidate', 'close'] as const)(
    'forbids new query/fill after %s',
    async (boundary) => {
      const result = deferred<string>()
      const physical = deferred<void>()
      let query!: () => void
      const load = new AiCatalogLoad((canQuery) => {
        query = canQuery
        return { result: result.promise, physicalCompletion: physical.promise }
      })
      const controller = new AbortController()
      const waiter = load.load(controller.signal, 'token').catch(() => null)
      if (boundary === 'gone') controller.abort()
      if (boundary === 'invalidate') load.invalidate()
      if (boundary === 'close') load.close()
      expect(query).toThrow('catalogue_unavailable')
      result.resolve('late')
      await Promise.resolve()
      physical.resolve()
      expect(await waiter).toBeNull()
      expect(load.reserveFill()).toBeNull()
    }
  )
})
