import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('client-only', () => ({}))
vi.mock('./reload-guard', () => ({
  allowReplacement: vi.fn(() => false),
  reconcileRecovery: vi.fn(),
}))

import { startVersionChecker } from './checker'
import { allowReplacement } from './reload-guard'

describe('global deployment checker', () => {
  let stop: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    stop?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('checks on mount and every 30 seconds, then removes timers and listeners', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ version: 'A' })))
    vi.stubGlobal('fetch', fetcher)
    stop = startVersionChecker('A')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    window.dispatchEvent(new Event('focus'))
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('coalesces focus/visibility with one in-flight request and times it out', async () => {
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((_url, init) => {
      signal = init.signal
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('abort')))
      )
    })
    vi.stubGlobal('fetch', fetcher)
    stop = startVersionChecker('A')
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(24_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    Response.json({ version: 'B' }, { status: 503 }),
    Response.json({ version: '<invalid>' }),
  ])('does not replace or retry rapidly on a bad signal', async (response) => {
    const fetcher = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetcher)
    stop = startVersionChecker('A')
    await vi.advanceTimersByTimeAsync(29_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(allowReplacement).not.toHaveBeenCalled()
  })
})
