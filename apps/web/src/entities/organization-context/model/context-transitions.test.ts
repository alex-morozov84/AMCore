import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import type { OrganizationContextInput } from './context-input'
import { createOrganizationContextScheduler } from './context-scheduler'

const binding = 'a'.repeat(64)
const actor = { id: 'actor', email: 'actor@example.test' }
const initial: OrganizationContextInput = { kind: 'selected', id: 'A', locale: 'en' }
function fixture() {
  const bootstrap = vi.fn(async () => ({ binding, actor }))
  const authority = vi.fn(async () => ({
    binding,
    data: { organization: { id: 'B', name: 'B', slug: 'b' }, canManageTeamAccess: true },
  }))
  const publish = vi.fn()
  const scheduler = createOrganizationContextScheduler(binding, initial, {
    bootstrap,
    authority,
    publish,
  })
  return { bootstrap, authority, publish, scheduler }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it.each([false, true])(
  'queued resume preserves latest input identity verification (changed=%s)',
  async (changed) => {
    const f = fixture()
    f.scheduler.activate()
    await vi.advanceTimersByTimeAsync(100)
    f.bootstrap.mockClear()
    f.authority.mockClear()
    f.publish.mockClear()
    let release!: (value: { binding: string; actor: typeof actor }) => void
    f.bootstrap.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    f.scheduler.activate()
    f.scheduler.setInput({ ...initial, id: 'B' })
    f.scheduler.setInput({ kind: 'list', page: 2, locale: 'ru' })
    await vi.advanceTimersByTimeAsync(99)
    expect(f.bootstrap).not.toHaveBeenCalled()
    expect(f.authority).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    expect(f.authority).not.toHaveBeenCalled()
    release({ binding: changed ? 'b'.repeat(64) : binding, actor })
    await vi.advanceTimersByTimeAsync(0)
    if (changed) {
      expect(f.scheduler.getSnapshot().status).toBe('changed')
      expect(f.authority).not.toHaveBeenCalled()
      expect(f.publish).not.toHaveBeenCalled()
    } else {
      expect(f.authority).toHaveBeenCalledExactlyOnceWith(
        { kind: 'list', page: 2, locale: 'ru' },
        binding,
        expect.any(AbortSignal)
      )
      expect(f.publish).toHaveBeenCalledTimes(1)
    }
    f.scheduler.stop()
  }
)

it.each(['bootstrap', 'authority'] as const)(
  'retarget keeps %s cooldown; expiry makes no HTTP',
  async (leg) => {
    const f = fixture()
    f[leg].mockRejectedValueOnce(new ApiRequestError(429, undefined, 2))
    f.scheduler.activate()
    await vi.advanceTimersByTimeAsync(100)
    const deadline = f.scheduler.getSnapshot().retryAt
    f.bootstrap.mockClear()
    f.authority.mockClear()
    f.scheduler.setInput({ ...initial, id: 'B' })
    f.scheduler.setInput({ kind: 'list', page: 2, locale: 'ru' })
    f.scheduler.activate()
    await vi.advanceTimersByTimeAsync(1999)
    expect(f.scheduler.getSnapshot()).toMatchObject({
      target: 'list:2:ru',
      retryAt: deadline,
      status: 'error',
    })
    expect(f.bootstrap).not.toHaveBeenCalled()
    expect(f.authority).not.toHaveBeenCalled()
    expect(f.publish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.scheduler.getSnapshot().retryAt).toBeUndefined()
    expect(f.bootstrap).not.toHaveBeenCalled()
    expect(f.authority).not.toHaveBeenCalled()
    f.scheduler.activate()
    await vi.advanceTimersByTimeAsync(100)
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    expect(f.authority).toHaveBeenCalledExactlyOnceWith(
      { kind: 'list', page: 2, locale: 'ru' },
      binding,
      expect.any(AbortSignal)
    )
    f.scheduler.stop()
  }
)

it('stop retires the consumer cooldown callback', async () => {
  const f = fixture()
  const listener = vi.fn()
  f.scheduler.subscribe(listener)
  f.bootstrap.mockRejectedValueOnce(new ApiRequestError(429, undefined, 2))
  f.scheduler.activate()
  await vi.advanceTimersByTimeAsync(100)
  f.scheduler.stop()
  listener.mockClear()
  await vi.advanceTimersByTimeAsync(2000)
  expect(listener).not.toHaveBeenCalled()
})
