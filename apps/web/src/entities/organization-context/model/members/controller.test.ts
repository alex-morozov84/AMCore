import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { createOrganizationAccessController } from './controller'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const saved = {
  memberId: 'member',
  userId: 'user',
  organizationId: 'org',
  roleIds: [],
  aclVersion: 2,
  changed: true,
}
afterEach(() => vi.useRealTimers())
describe('transport and follow-up settlement', () => {
  it.each(['ready', 'denied', 'error'] as const)(
    'focus midwrite starts follow-up without cycle and holds duplicate guard: %s',
    async (outcome) => {
      const c = createOrganizationAccessController('binding', 'org')
      c.setAuthority(true)
      const transport = deferred<typeof saved>()
      const followup = deferred<typeof outcome>()
      const refresh = vi.fn(async () => {
        await c.waitTransports()
        return followup.promise
      })
      c.setRefresh(refresh)
      const request = vi.fn(() => transport.promise)
      const save = c.save('member', request)
      const focus = c.refresh()
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(c.isBusy('member')).toBe(true)
      transport.resolve(saved)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(await c.save('member', request)).toEqual({ status: 'busy' })
      expect(request).toHaveBeenCalledTimes(1)
      followup.resolve(outcome)
      await focus
      expect(await save).toMatchObject({ status: 'committed', followup: outcome })
      expect(c.isBusy()).toBe(false)
    }
  )
  it('acknowledged commit stays committed after follow-up deadline, exit/busy restored', async () => {
    vi.useFakeTimers()
    const c = createOrganizationAccessController('b', 'o')
    c.setAuthority(true)
    c.setRefresh(() => new Promise(() => undefined))
    const save = c.save('member', async () => saved)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await save).toMatchObject({ status: 'committed', followup: 'error' })
    expect(c.isBusy()).toBe(false)
    expect(c.allowed()).toBe(false)
  })
  it('transport deadline opens read barrier, no replay, max10s operation wait', async () => {
    vi.useFakeTimers()
    const c = createOrganizationAccessController('b', 'o')
    c.setAuthority(true)
    c.setRefresh(async () => {
      await c.waitTransports()
      return 'ready'
    })
    const request = vi.fn(() => new Promise<typeof saved>(() => undefined))
    const save = c.save('member', request)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await save).toMatchObject({ status: 'unknown' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(c.isBusy()).toBe(false)
  })
  it('synthetic safe503 is unknown after deliberate observed reread', async () => {
    const c = createOrganizationAccessController('b', 'o')
    c.setAuthority(true)
    const read = vi.fn(async () => saved)
    c.registerRead(read)
    c.setRefresh(async () => 'ready')
    const request = vi.fn(async () => {
      throw new ApiRequestError(503, { errorCode: 'MEMBER_ROLES_SAVE_UNAVAILABLE' } as never)
    })
    expect(await c.save('member', request)).toMatchObject({ status: 'unknown' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('retired success/error/finally cannot publish and same-controller remount stays busy', async () => {
    const c = createOrganizationAccessController('b', 'o')
    c.setAuthority(true)
    const transport = deferred<typeof saved>()
    c.setRefresh(async () => 'ready')
    const save = c.save('member', () => transport.promise)
    expect(await c.save('member', async () => saved)).toEqual({ status: 'busy' })
    c.retire()
    transport.resolve(saved)
    expect(await save).toEqual({ status: 'retired' })
    expect(c.isBusy()).toBe(false)
  })
  it.each(['target', 'resume'] as const)(
    'retired follow-up rejection/deadline cannot poison new authority: %s',
    async (change) => {
      for (const deadline of [false, true]) {
        vi.useFakeTimers()
        const c = createOrganizationAccessController('b', 'old')
        c.setAuthority(true)
        const old = deferred<'ready'>()
        const entered = deferred<void>()
        c.setRefresh(async () => {
          entered.resolve()
          return old.promise
        })
        const saving = c.save('member', async () => saved)
        await entered.promise
        if (change === 'target') c.setTarget('new')
        else {
          c.retire()
          c.resume()
        }
        c.setAuthority(true)
        if (deadline) await vi.advanceTimersByTimeAsync(4900)
        const newer = deferred<'ready'>()
        c.setRefresh(async () => newer.promise)
        const next = c.save(change === 'target' ? 'member' : 'other', async () => saved)
        await Promise.resolve()
        await Promise.resolve()
        if (deadline) await vi.advanceTimersByTimeAsync(100)
        else old.reject(new Error('late old follow-up'))
        expect(await saving).toEqual({ status: 'retired' })
        expect(c.allowed()).toBe(true)
        expect(c.isBusy(change === 'target' ? 'member' : 'other')).toBe(true)
        newer.resolve('ready')
        expect(await next).toMatchObject({ status: 'committed' })
        expect(c.isBusy()).toBe(false)
        vi.useRealTimers()
      }
    }
  )
})
