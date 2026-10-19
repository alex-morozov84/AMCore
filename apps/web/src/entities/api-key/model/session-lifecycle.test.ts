import { afterEach, describe, expect, it, vi } from 'vitest'

import { observeOwnKeySession, OwnKeySession } from './session-lifecycle'

vi.mock('client-only', () => ({}))
afterEach(() => vi.useRealTimers())
describe('scoped session observation', () => {
  it('keeps pageshow installed after pagehide and never resurrects discarded state', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const verify = vi.fn().mockResolvedValue({ verified: true })
    const session = new OwnKeySession(verify)
    const discard = vi.fn()
    const cleanup = observeOwnKeySession(session, () => false, discard)
    await vi.waitFor(() => expect(session.getSnapshot()).toBe('verified'))
    window.dispatchEvent(new Event('pagehide'))
    expect(discard).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toBe('unverified')
    const count = verify.mock.calls.length
    window.dispatchEvent(new Event('pageshow'))
    await vi.waitFor(() => expect(verify.mock.calls.length).toBe(count + 1))
    expect(discard).toHaveBeenCalledOnce()
    cleanup()
    const finalCount = verify.mock.calls.length
    window.dispatchEvent(new Event('pageshow'))
    expect(verify).toHaveBeenCalledTimes(finalCount)
  })
  it('does not let a pre-blur probe revalidate a concealed result', async () => {
    let release!: () => void
    const verify = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
      .mockResolvedValue(undefined)
    const session = new OwnKeySession(verify)
    const beforeBlur = session.check()
    session.conceal()
    release()
    await beforeBlur
    expect(session.getSnapshot()).toBe('unverified')
    expect(await session.freshCheck(true)).toBe(true)
    expect(session.getSnapshot()).toBe('verified')
  })

  it('coalesces concurrent mount/focus fresh checks without invalidating their new probe', async () => {
    const verify = vi.fn().mockResolvedValue(undefined)
    const session = new OwnKeySession(verify)
    expect(await Promise.all([session.freshCheck(), session.freshCheck(true)])).toEqual([
      true,
      true,
    ])
    expect(verify).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toBe('verified')
  })

  it('does not periodically probe an idle inventory', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const verify = vi.fn().mockResolvedValue({ verified: true })
    const session = new OwnKeySession(verify)
    const cleanup = observeOwnKeySession(
      session,
      () => false,
      () => undefined
    )
    await vi.advanceTimersByTimeAsync(20000)
    expect(verify).toHaveBeenCalledOnce()
    cleanup()
  })
  it('coalesces overlapping probes and uses a new probe after an earlier one', async () => {
    let release!: () => void
    const first = new Promise<void>((resolve) => {
      release = resolve
    })
    const verify = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined)
    const session = new OwnKeySession(verify)
    const a = session.check()
    const b = session.check()
    const postflight = session.freshCheck()
    expect(verify).toHaveBeenCalledOnce()
    release()
    await Promise.all([a, b, postflight])
    expect(verify).toHaveBeenCalledTimes(2)
  })
})

it('offers manual retry only after a failed probe, not ordinary concealment or an automatic retry', async () => {
  const verify = vi.fn().mockResolvedValue(undefined)
  const session = new OwnKeySession(verify)
  await session.check()
  session.conceal()
  expect(session.getFailureSnapshot()).toBe(false)
  verify.mockRejectedValueOnce(new Error('temporary network failure'))
  await session.check()
  expect(session.getSnapshot()).toBe('unverified')
  expect(session.getFailureSnapshot()).toBe(true)
  const retry = session.check()
  expect(session.getFailureSnapshot()).toBe(false)
  await retry
  expect(session.getSnapshot()).toBe('verified')
})
