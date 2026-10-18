import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { provisioningAdmissionDeadline } from './provisioning-admission-deadline.js'

function pending<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('provisioning admission application deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('aborts an unsent command without entering domain continuation', async () => {
    const queued = pending<number>()
    const continuation = jest.fn()
    let signal!: AbortSignal
    const result = provisioningAdmissionDeadline((input) => {
      signal = input
      input.addEventListener('abort', () => queued.reject(new Error('Unsent aborted')), {
        once: true,
      })
      return queued.promise
    }).then(continuation, (error: unknown) => error)
    await jest.advanceTimersByTimeAsync(250)
    expect(signal.aborted).toBe(true)
    expect(await result).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
    expect(continuation).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each(['success', 'failure'] as const)(
    'handles a sent command with late %s without domain continuation',
    async (outcome) => {
      const sent = pending<number>()
      const continuation = jest.fn()
      // Sent commands intentionally ignore abort, matching installed-client waitingForReply.
      const result = provisioningAdmissionDeadline(() => sent.promise).then(
        continuation,
        (error: unknown) => error
      )
      await jest.advanceTimersByTimeAsync(250)
      expect(await result).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
      if (outcome === 'success') sent.resolve(1)
      else sent.reject(new Error('Late transport failure'))
      await Promise.resolve()
      expect(continuation).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    }
  )

  it('rejects a late reply even before a delayed timer callback runs', async () => {
    const sent = pending<number>()
    const clock = jest.spyOn(performance, 'now')
    clock.mockReturnValueOnce(0).mockReturnValue(251)
    const result = provisioningAdmissionDeadline(() => sent.promise).catch(
      (error: unknown) => error
    )
    sent.resolve(1)
    expect(await result).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
    expect(jest.getTimerCount()).toBe(0)
    clock.mockRestore()
  })

  it('allows timely completion exactly once and clears its timer', async () => {
    const sent = pending<number>()
    const continuation = jest.fn()
    const result = provisioningAdmissionDeadline(() => sent.promise).then(continuation)
    sent.resolve(1)
    await result
    await jest.advanceTimersByTimeAsync(1000)
    expect(continuation).toHaveBeenCalledTimes(1)
    expect(continuation).toHaveBeenCalledWith(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('cleans up a synchronous enqueue failure', async () => {
    await expect(
      provisioningAdmissionDeadline(() => {
        throw new Error('enqueue')
      })
    ).rejects.toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
    expect(jest.getTimerCount()).toBe(0)
  })
})
