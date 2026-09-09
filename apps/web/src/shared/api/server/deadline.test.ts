import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeadlineController, withDeadline } from './deadline'

vi.mock('server-only', () => ({}))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createDeadlineController', () => {
  it('aborts the signal once timeoutMs elapses, not marked as caller-cancelled', () => {
    const { signal, isCallerCancelled, cleanup } = createDeadlineController(1_000)

    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(1_000)

    expect(signal.aborted).toBe(true)
    expect(isCallerCancelled()).toBe(false)
    cleanup()
  })

  it('aborts immediately when the caller signal aborts, marked as caller-cancelled', () => {
    const callerController = new AbortController()
    const { signal, isCallerCancelled, cleanup } = createDeadlineController(
      60_000,
      callerController.signal
    )

    callerController.abort('caller gave up')

    expect(signal.aborted).toBe(true)
    expect(isCallerCancelled()).toBe(true)
    cleanup()
  })

  it('cleanup() prevents the deadline timer from firing later', () => {
    const { signal, cleanup } = createDeadlineController(1_000)
    cleanup()
    vi.advanceTimersByTime(1_000)

    expect(signal.aborted).toBe(false)
  })
})

describe('withDeadline', () => {
  it('resolves with the promise value when it settles before the deadline', async () => {
    const { signal, cleanup } = createDeadlineController(1_000)

    await expect(withDeadline(Promise.resolve('ok'), signal)).resolves.toBe('ok')
    cleanup()
  })

  it('rejects with the deadline reason when the promise never settles in time', async () => {
    const { signal, cleanup } = createDeadlineController(1_000)
    const neverSettles = new Promise(() => {})

    const result = withDeadline(neverSettles, signal)
    vi.advanceTimersByTime(1_000)

    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    cleanup()
  })

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('already gone')

    await expect(withDeadline(Promise.resolve('ok'), controller.signal)).rejects.toBe(
      'already gone'
    )
  })
})
