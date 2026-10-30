// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionRefreshUnsafeError } from './errors'
import { startLockRenewal } from './lock-renewal'
import type { VaultLock } from './session-vault.types'

vi.mock('server-only', () => ({}))

const options = { ttlMs: 10_000, intervalMs: 4000, ceilingMs: 30_000 }
const lockWith = (renew: VaultLock['renew']): VaultLock => ({
  acquire: async () => 'tok',
  renew,
  release: async () => undefined,
})

describe('startLockRenewal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const start = (lock: VaultLock, opts = options) => {
    const controller = new AbortController()
    const handle = startLockRenewal('s1', 'tok', lock, controller, opts)
    const outcome = handle.unsafe.then(
      () => 'never',
      (error: unknown) => error
    )
    return { handle, controller, outcome }
  }

  it('renews on every interval while healthy and never fails', async () => {
    const renew = vi.fn(async () => true)
    const { handle, controller } = start(lockWith(renew))
    await vi.advanceTimersByTimeAsync(12_100)
    expect(renew).toHaveBeenCalledTimes(3)
    expect(controller.signal.aborted).toBe(false)
    handle.stop()
  })

  it('a refused renewal fails closed and aborts the work', async () => {
    const { controller, outcome } = start(lockWith(async () => false))
    await vi.advanceTimersByTimeAsync(4100)
    await expect(outcome).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
    expect(controller.signal.aborted).toBe(true)
  })

  it('a rejected renewal fails closed', async () => {
    const { outcome } = start(
      lockWith(async () => {
        throw new Error('redis down')
      })
    )
    await vi.advanceTimersByTimeAsync(4100)
    await expect(outcome).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
  })

  it('ticks never overlap, and a renewal unresolved for a whole interval counts as failed', async () => {
    const renew = vi.fn(() => new Promise<boolean>(() => undefined))
    const { outcome } = start(lockWith(renew))
    await vi.advanceTimersByTimeAsync(4100)
    expect(renew).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(renew).toHaveBeenCalledTimes(1)
    await expect(outcome).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
  })

  it('the ceiling fails closed even with successful renewals', async () => {
    const { outcome } = start(lockWith(async () => true))
    await vi.advanceTimersByTimeAsync(30_100)
    await expect(outcome).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
  })

  it('is inert after stop: a late refusal neither fails nor aborts anything', async () => {
    let finish!: (value: boolean) => void
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const { handle, controller, outcome } = start(lockWith(renew))
    await vi.advanceTimersByTimeAsync(4100)
    handle.stop()
    finish(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(controller.signal.aborted).toBe(false)
    const pending = Symbol('pending')
    await expect(Promise.race([outcome, Promise.resolve(pending)])).resolves.toBe(pending)
  })
})
