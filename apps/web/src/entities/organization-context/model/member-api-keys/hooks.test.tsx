import type { PropsWithChildren } from 'react'
import type { MemberKeyList } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memberKeysClient } from '../../api/member-api-keys-client'
import { createOrganizationAccessController } from '../access-controller'

import { useMemberApiKeys } from './hooks'

vi.mock('../../api/member-api-keys-client', () => ({
  memberKeysClient: { list: vi.fn(), revoke: vi.fn() },
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const snapshot = (name: string): MemberKeyList => ({
  organization: { id: 'org', name },
  member: { memberId: 'member', userId: 'user', name: null, email: 'user@example.test' },
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  revocableCount: 0,
  revokeAllLimit: 1000,
  asOf: '2026-10-18T00:00:00.000Z',
})
function fixture() {
  const controller = createOrganizationAccessController('binding', 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { controller, client, wrapper }
}
beforeEach(() => vi.resetAllMocks())
describe('member key hook target lease', () => {
  it.each(['user', 'member', 'organization', 'binding', 'unmount'] as const)(
    'retires pending reads, writes and captured callbacks on %s change',
    async (dimension) => {
      const { controller, client, wrapper } = fixture()
      const read = deferred<MemberKeyList>()
      const write = deferred<Awaited<ReturnType<typeof memberKeysClient.revoke>>>()
      let readSignal!: AbortSignal
      vi.mocked(memberKeysClient.list)
        .mockImplementationOnce((_b, _o, _u, _q, signal) => {
          readSignal = signal
          return read.promise
        })
        .mockResolvedValue(snapshot('new'))
      vi.mocked(memberKeysClient.revoke).mockReturnValueOnce(write.promise)
      const initial = { controller, user: 'user', member: 'member' }
      const { result, rerender, unmount } = renderHook(
        (props) =>
          useMemberApiKeys(props.controller, props.user, {
            expectedMemberId: props.member,
            page: 1,
            limit: 20,
            status: 'all',
          }),
        { wrapper, initialProps: initial }
      )
      await waitFor(() => expect(memberKeysClient.list).toHaveBeenCalledTimes(1))
      const captured = result.current.revoke
      let pending!: ReturnType<typeof captured>
      act(() => {
        pending = captured('key')
      })
      expect(controller.isBusy('member')).toBe(true)
      if (dimension === 'unmount') unmount()
      else {
        const next = { ...initial }
        if (dimension === 'user') next.user = 'other-user'
        if (dimension === 'member') next.member = 'rejoined-member'
        if (dimension === 'organization') {
          act(() => controller.setTarget('other-org'))
          act(() => controller.setAuthority(true))
        }
        if (dimension === 'binding') {
          next.controller = createOrganizationAccessController('other-binding', 'org')
          next.controller.setAuthority(true)
          next.controller.setRefresh(async () => 'ready')
          act(() => controller.retire())
        }
        rerender(next)
        await waitFor(() => expect(result.current.data?.organization.name).toBe('new'))
        const call = vi.mocked(memberKeysClient.list).mock.calls.at(-1)!
        expect(call.slice(0, 3)).toEqual([
          next.controller.binding,
          next.controller.organizationId,
          next.user,
        ])
        expect(call[3].expectedMemberId).toBe(next.member)
      }
      expect(readSignal.aborted).toBe(true)
      await expect(captured('another-key')).resolves.toEqual({ status: 'retired' })
      await act(async () => {
        read.resolve(snapshot('old'))
        write.resolve({
          organizationId: 'org',
          userId: 'user',
          memberId: 'member',
          requestedCount: 1,
          affectedCount: 1,
        })
        expect(await pending).toEqual({ status: 'retired' })
      })
      expect(memberKeysClient.revoke).toHaveBeenCalledTimes(1)
      expect(controller.isBusy()).toBe(false)
      if (dimension !== 'unmount') expect(result.current.data?.organization.name).toBe('new')
      const cache = client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data)
      expect(cache).not.toContainEqual(snapshot('old'))
    }
  )
  it('masks a late failed write after member replacement', async () => {
    const { controller, wrapper } = fixture()
    vi.mocked(memberKeysClient.list).mockResolvedValue(snapshot('current'))
    const write = deferred<never>()
    vi.mocked(memberKeysClient.revoke).mockReturnValueOnce(write.promise)
    const { result, rerender } = renderHook(
      ({ member }) =>
        useMemberApiKeys(controller, 'user', {
          expectedMemberId: member,
          page: 1,
          limit: 20,
          status: 'all',
        }),
      { wrapper, initialProps: { member: 'member' } }
    )
    let pending!: ReturnType<typeof result.current.revoke>
    act(() => {
      pending = result.current.revoke()
    })
    rerender({ member: 'replacement' })
    await act(async () => {
      write.reject(new Error('lost acknowledgment'))
      expect(await pending).toEqual({ status: 'retired' })
    })
    expect(result.current.error).toBeUndefined()
    expect(controller.isBusy()).toBe(false)
  })
})
