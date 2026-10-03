import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { membersClient } from '../../api/members-client'

import { createOrganizationAccessController } from './controller'
import { useMemberRoleAssignments, useOrganizationMembers } from './hooks'

vi.mock('../../api/members-client', () => ({
  membersClient: { list: vi.fn(), roles: vi.fn(), save: vi.fn() },
}))
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture() {
  const controller = createOrganizationAccessController('binding', 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { controller, wrapper, client }
}
describe('headless member lifecycle fences', () => {
  it('retired query success cannot populate new target; aborts old transport', async () => {
    const { controller, wrapper } = fixture()
    const old = deferred<never>()
    let signal!: AbortSignal
    vi.mocked(membersClient.list).mockImplementationOnce((_b, _o, _q, s) => {
      signal = s
      return old.promise
    })
    vi.mocked(membersClient.list).mockResolvedValueOnce({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      aclVersion: 2,
    })
    const { result, rerender } = renderHook(
      ({ search }) => useOrganizationMembers(controller, { page: 1, search }),
      { wrapper, initialProps: { search: 'old' } }
    )
    await waitFor(() => expect(membersClient.list).toHaveBeenCalled())
    rerender({ search: 'new' })
    await waitFor(() => expect(result.current.data?.aclVersion).toBe(2))
    expect(signal.aborted).toBe(true)
    await act(async () => old.resolve({ aclVersion: 1 } as never))
    expect(result.current.data?.aclVersion).toBe(2)
  })
  it.each(['success', 'failure'] as const)(
    'editor target retirement masks late %s and retains operation guard until settlement',
    async (kind) => {
      const { controller, wrapper } = fixture()
      const write = deferred<never>()
      vi.mocked(membersClient.roles).mockResolvedValue({
        member: {
          memberId: 'member',
          user: { id: 'user', email: 'user@example.test', name: null },
        },
        aclVersion: 1,
        assignedRoleCount: 0,
        assignedRoles: [],
        editMode: 'editable',
        choices: { data: [], total: 0, page: 1, limit: 20 },
      })
      vi.mocked(membersClient.save).mockImplementationOnce(() => write.promise)
      const { result, rerender } = renderHook(
        ({ userId }) =>
          useMemberRoleAssignments(controller, {
            userId,
            page: 1,
            search: '',
            section: 'available',
          }),
        { wrapper, initialProps: { userId: 'user' } }
      )
      await waitFor(() => expect(result.current.data).toBeDefined())
      let pending!: ReturnType<typeof result.current.save>
      act(() => {
        pending = result.current.save({
          expectedMemberId: 'member',
          expectedAclVersion: 1,
          roleIds: [],
        })
      })
      expect(controller.isBusy('member')).toBe(true)
      rerender({ userId: 'another' })
      await act(async () => {
        if (kind === 'success')
          write.resolve({
            memberId: 'member',
            userId: 'user',
            organizationId: 'org',
            roleIds: [],
            aclVersion: 1,
            changed: false,
          } as never)
        else write.reject(new Error('late network failure'))
        expect(await pending).toEqual({ status: 'retired' })
      })
      expect(controller.isBusy()).toBe(false)
    }
  )
  it('list observes busy release after unchanged follow-up data and restores Edit controls', async () => {
    const { controller, wrapper } = fixture()
    const write = deferred<never>()
    const rows = { data: [], total: 0, page: 1, limit: 20, aclVersion: 1 }
    vi.mocked(membersClient.list).mockResolvedValue(rows)
    const { result } = renderHook(
      () => useOrganizationMembers(controller, { page: 1, search: '' }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    let pending!: ReturnType<typeof controller.save>
    act(() => {
      pending = controller.save('member', () => write.promise)
    })
    expect(result.current.busy).toBe(true)
    await act(async () => {
      write.resolve({
        memberId: 'member',
        userId: 'user',
        organizationId: 'org',
        roleIds: [],
        aclVersion: 1,
        changed: false,
      } as never)
      await pending
    })
    expect(result.current.busy).toBe(false)
    expect(result.current.ready).toBe(true)
  })
  it('a read deadline settles even if the loader ignores abort, without publishing late data', async () => {
    vi.useFakeTimers()
    try {
      const { controller, wrapper } = fixture()
      const read = deferred<never>()
      vi.mocked(membersClient.list).mockImplementationOnce(() => read.promise)
      const { result } = renderHook(
        () => useOrganizationMembers(controller, { page: 1, search: 'timeout' }),
        { wrapper }
      )
      await act(async () => vi.advanceTimersByTimeAsync(5000))
      expect(result.current.pending).toBe(false)
      expect(result.current.error).toBeDefined()
      await act(async () => read.resolve({ aclVersion: 42 } as never))
      expect(result.current.data).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
  it('honors read Retry-After before permitting recovery', async () => {
    vi.useFakeTimers()
    try {
      const { controller, wrapper } = fixture()
      const unavailable = new ApiRequestError(503, undefined, 2)
      vi.mocked(membersClient.list).mockRejectedValueOnce(unavailable)
      const { result } = renderHook(
        () => useOrganizationMembers(controller, { page: 1, search: 'cooldown' }),
        { wrapper }
      )
      await act(async () => {})
      expect(result.current.retryAt).toBeDefined()
      const before = vi.mocked(membersClient.list).mock.calls.length
      await expect(result.current.refresh()).rejects.toBe(unavailable)
      expect(membersClient.list).toHaveBeenCalledTimes(before)
      await act(async () => vi.advanceTimersByTimeAsync(2000))
      expect(result.current.retryAt).toBeUndefined()
      vi.mocked(membersClient.list).mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        aclVersion: 3,
      })
      await act(async () => result.current.refresh())
      expect(result.current.error).toBeUndefined()
      expect(result.current.data?.aclVersion).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
