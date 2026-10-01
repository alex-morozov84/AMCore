import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import type { OrganizationContextData } from '../api/context-client'

import { contextAffordances } from './context-fixture'
import { type OrganizationContextInput, organizationContextKey } from './context-input'
import { createOrganizationContextScheduler } from './context-scheduler'

const binding = 'a'.repeat(64)
const selected: OrganizationContextInput = { kind: 'selected', id: 'A', locale: 'ru' }
const overview = {
  binding,
  data: {
    organization: { id: 'A', name: 'Company A', slug: 'a' },
    canManageTeamAccess: true,
    ...contextAffordances,
  },
}
const actor = { id: 'actor', email: 'actor@example.test' }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture(input = selected) {
  const events: string[] = []
  const client = new QueryClient()
  const bootstrap = vi.fn(async () => {
    events.push('bootstrap')
    return { binding, actor }
  })
  const authority = vi.fn(async () => {
    events.push('domain')
    return overview
  })
  const publish = vi.fn((target: OrganizationContextInput, data: OrganizationContextData) =>
    client.setQueryData(organizationContextKey(binding, target), data)
  )
  const scheduler = createOrganizationContextScheduler(binding, input, {
    bootstrap,
    authority,
    publish,
  })
  return { events, client, bootstrap, authority, publish, scheduler }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const settle = () => vi.advanceTimersByTimeAsync(100)

describe('ordered organization authority scheduler', () => {
  it.each(['production', 'strict-effect replay'])(
    'mount verifies identity then one domain in %s',
    async (mode) => {
      const f = fixture()
      f.scheduler.activate()
      if (mode !== 'production') {
        f.scheduler.stop()
        f.scheduler.activate()
      }
      expect(f.events).toEqual([])
      await settle()
      expect(f.events).toEqual(['bootstrap', 'domain'])
      expect(f.publish).toHaveBeenCalledTimes(1)
      expect(f.scheduler.getSnapshot().status).toBe('ready')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(f.events).toHaveLength(2)
      f.scheduler.stop()
    }
  )
  it('suspends synchronously and trails focus/visible/pageshow/manual burst once', async () => {
    const f = fixture()
    f.scheduler.activate()
    await settle()
    f.events.length = 0
    f.scheduler.activate()
    expect(f.scheduler.getSnapshot().status).toBe('pending')
    await vi.advanceTimersByTimeAsync(50)
    f.scheduler.activate()
    f.scheduler.activate()
    f.scheduler.activate()
    await vi.advanceTimersByTimeAsync(99)
    expect(f.events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(f.events).toEqual(['bootstrap', 'domain'])
    f.scheduler.stop()
  })
  it('joins in-flight verification without a second bootstrap or domain', async () => {
    const f = fixture()
    const waiting = deferred<{ binding: string; actor: typeof actor }>()
    f.bootstrap.mockReturnValueOnce(waiting.promise)
    f.scheduler.activate()
    await settle()
    f.scheduler.activate()
    f.scheduler.activate()
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    expect(f.authority).not.toHaveBeenCalled()
    waiting.resolve({ binding, actor })
    await settle()
    expect(f.authority).toHaveBeenCalledTimes(1)
    f.scheduler.stop()
  })
  it('changed login binding stops before authority and cannot adopt via target change', async () => {
    const f = fixture()
    f.bootstrap.mockResolvedValueOnce({ binding: 'b'.repeat(64), actor })
    f.scheduler.activate()
    await settle()
    expect(f.scheduler.getSnapshot().status).toBe('changed')
    f.scheduler.setInput({ ...selected, kind: 'selected', id: 'B' })
    f.scheduler.activate()
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    expect(f.authority).not.toHaveBeenCalled()
    expect(f.publish).not.toHaveBeenCalled()
    f.scheduler.stop()
  })
  it('bootstrap outage suspends before authority; manual retry verifies again', async () => {
    const f = fixture()
    f.bootstrap.mockRejectedValueOnce(new Error('offline'))
    f.scheduler.activate()
    await settle()
    expect(f.scheduler.getSnapshot().status).toBe('error')
    expect(f.authority).not.toHaveBeenCalled()
    f.scheduler.activate()
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(2)
    expect(f.authority).toHaveBeenCalledTimes(1)
    f.scheduler.stop()
  })
  it('validated target/locale/page change makes one active authority without bootstrap', async () => {
    const f = fixture()
    f.scheduler.activate()
    await settle()
    f.scheduler.setInput({ kind: 'selected', id: 'B', locale: 'en' })
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    expect(f.authority).toHaveBeenCalledTimes(2)
    expect(f.authority).toHaveBeenLastCalledWith(
      { kind: 'selected', id: 'B', locale: 'en' },
      binding,
      expect.any(AbortSignal)
    )
    f.scheduler.setInput({ kind: 'list', page: 2, locale: 'en' })
    await settle()
    expect(f.authority).toHaveBeenCalledTimes(3)
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    f.scheduler.stop()
  })
  it('denied next-request authority never publishes stale success or changes target', async () => {
    const f = fixture()
    f.scheduler.activate()
    await settle()
    f.authority.mockRejectedValueOnce(new ApiRequestError(404, undefined))
    f.scheduler.activate()
    await settle()
    expect(f.scheduler.getSnapshot()).toMatchObject({ status: 'denied', target: 'selected:A:ru' })
    expect(f.publish).toHaveBeenCalledTimes(1)
    f.scheduler.stop()
  })
  it('retired response and settled old action cannot update actual cache/callback', async () => {
    const f = fixture()
    f.scheduler.activate()
    await settle()
    const action = deferred<string>()
    const callback = vi.fn()
    const result = f.scheduler.action(() => action.promise, callback)
    const response = deferred<typeof overview>()
    f.authority.mockReturnValueOnce(response.promise)
    f.scheduler.setInput({ kind: 'selected', id: 'B', locale: 'ru' })
    f.scheduler.stop()
    response.resolve(overview)
    action.resolve('committed')
    await result
    await settle()
    expect(callback).not.toHaveBeenCalled()
    expect(
      f.client.getQueryData(
        organizationContextKey(binding, { kind: 'selected', id: 'B', locale: 'ru' })
      )
    ).toBeUndefined()
    expect(f.publish).toHaveBeenCalledTimes(1)
  })
  it('429 disables early retry without polling; explicit recovery after Retry-After', async () => {
    const f = fixture()
    f.bootstrap.mockRejectedValueOnce(new ApiRequestError(429, undefined, 2))
    f.scheduler.activate()
    await settle()
    expect(f.scheduler.getSnapshot().retryAt).toBeGreaterThan(Date.now())
    f.scheduler.activate()
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.scheduler.getSnapshot().retryAt).toBeUndefined()
    expect(f.bootstrap).toHaveBeenCalledTimes(1)
    f.scheduler.activate()
    await settle()
    expect(f.bootstrap).toHaveBeenCalledTimes(2)
    expect(f.events).toEqual(['bootstrap', 'domain'])
    f.scheduler.stop()
  })
})
