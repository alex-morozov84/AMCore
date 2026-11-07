import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { invitationsClient } from '../api/invitations-client'
import { memberKeysClient } from '../api/member-api-keys-client'
import * as removalTransport from '../api/member-removal-client'
import { membersClient } from '../api/members-client'
import { rolesClient } from '../api/roles-client'

import { createOrganizationAccessController } from './access-controller'
import { useInvitationManagerOperations } from './invitations/hooks'
import { useMemberApiKeys } from './member-api-keys/hooks'
import { useMemberRemoval } from './member-removal/hooks'
import { useMemberRoleAssignments } from './members/hooks'
import { useCreateRoleDefinition, useRoleDefinition, useRoleDefinitions } from './roles/hooks'

vi.mock('client-only', () => ({}))
const binding = 'a'.repeat(64)
const clients: QueryClient[] = []
const params = { page: 1, search: '' }
const key = (family: string, input: unknown, session = binding, org = 'org') =>
  [family, JSON.stringify([session, org, input])] as const
const listKey = key('organization-role-definitions', params)
const otherKey = key('organization-role-definitions', params, 'b'.repeat(64))
const otherOrgKey = key('organization-role-definitions', params, binding, 'another-org')
const role = {
  id: 'role',
  name: 'Before',
  description: null,
  isSystem: false,
  organizationId: 'org',
}
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const access = createOrganizationAccessController(binding, 'org')
  access.setAuthority(true)
  access.setRefresh(async () => 'ready')
  client.setQueryData(otherKey, { preserved: true })
  client.setQueryData(otherOrgKey, { preserved: true })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const unchanged = () => {
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(otherOrgKey)?.isInvalidated).toBe(false)
  }
  return { client, access, wrapper, unchanged }
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(['rename', 'delete'] as const)(
  'a real role %s invalidates the inactive list before return',
  async (action) => {
    const f = fixture()
    let rows = [role]
    const list = vi.spyOn(rolesClient, 'list').mockImplementation(
      async () =>
        ({
          data: rows,
          total: rows.length,
          page: 1,
          limit: 20,
          aclVersion: 1,
        }) as never
    )
    vi.spyOn(rolesClient, 'detail').mockResolvedValue({ role, aclVersion: 1 } as never)
    const save = vi.spyOn(rolesClient, 'save').mockImplementation(async () => {
      rows = [{ ...role, name: 'After' }]
      return { changed: true } as never
    })
    const remove = vi.spyOn(rolesClient, 'remove').mockImplementation(async () => {
      rows = []
      return { removed: true } as never
    })
    const initial = renderHook(() => useRoleDefinitions(f.access, params), { wrapper: f.wrapper })
    await waitFor(() => expect(initial.result.current.data?.data[0]?.name).toBe('Before'))
    initial.unmount()
    const detail = renderHook(() => useRoleDefinition(f.access, 'role'), { wrapper: f.wrapper })
    await waitFor(() => expect(detail.result.current.available).toBe(true))
    await act(async () => {
      const result =
        action === 'rename'
          ? await detail.result.current.save({
              expectedAclVersion: 1,
              name: 'After',
              description: null,
              presets: [],
            })
          : await detail.result.current.remove({
              expectedAclVersion: 1,
              expectedLiveInvitationCount: 0,
            })
      expect(result).toMatchObject({ status: 'committed', followup: 'ready' })
    })
    expect(action === 'rename' ? save : remove).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
    f.unchanged()
    detail.unmount()
    const returned = renderHook(() => useRoleDefinitions(f.access, params), { wrapper: f.wrapper })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(returned.result.current.data?.data).toEqual(rows))
    expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(false)
  }
)

it('role creation invalidates a previously visited inactive list', async () => {
  const f = fixture()
  f.client.setQueryData(listKey, { data: [] })
  const create = vi.spyOn(rolesClient, 'create').mockResolvedValue({ role } as never)
  const hook = renderHook(() => useCreateRoleDefinition(f.access), { wrapper: f.wrapper })
  await act(async () => {
    expect(await hook.result.current.create({ name: 'After', description: null })).toMatchObject({
      status: 'committed',
    })
  })
  expect(create).toHaveBeenCalledOnce()
  expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
  f.unchanged()
})

it.each(['reject', 'abort'] as const)(
  'member write retires active/inactive data before authority can %s',
  async (failure) => {
    if (failure === 'abort') vi.useFakeTimers()
    const f = fixture()
    const input = { userId: 'user', ...params, section: 'available' as const }
    const activeKey = key('organization-members', input)
    f.client.setQueryData(activeKey, { member: { memberId: 'member' } })
    f.client.setQueryData(listKey, { data: [role] })
    const save = vi.spyOn(membersClient, 'save').mockResolvedValue({ changed: true } as never)
    const read = vi.spyOn(membersClient, 'roles')
    let authoritySignal: AbortSignal | undefined
    f.access.setRefresh(async (signal) => {
      authoritySignal = signal
      expect(f.client.getQueryState(activeKey)?.isInvalidated).toBe(true)
      expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
      if (failure === 'reject') throw new Error('AUTHORITY_UNAVAILABLE')
      return new Promise((_, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('ABORTED')), { once: true })
      )
    })
    const hook = renderHook(() => useMemberRoleAssignments(f.access, input), { wrapper: f.wrapper })
    let pending!: ReturnType<typeof hook.result.current.save>
    await act(async () => {
      pending = hook.result.current.save({
        expectedMemberId: 'member',
        expectedAclVersion: 1,
        roleIds: ['role'],
      })
    })
    if (failure === 'abort')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5001)
      })
    await act(async () => {
      expect(await pending).toMatchObject({ status: 'committed', followup: 'error' })
    })
    if (failure === 'abort') expect(authoritySignal?.aborted).toBe(true)
    expect(f.client.getQueryState(activeKey)?.isInvalidated).toBe(true)
    expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    f.unchanged()
  }
)

it('invitation acknowledgment invalidates dependencies before suspended authority returns denied', async () => {
  const f = fixture()
  const activeKey = key('organization-invitations', params)
  const inactiveKey = key('organization-role-definition', 'role')
  f.client.setQueryData(activeKey, { data: [] })
  f.client.setQueryData(inactiveKey, { role })
  const observer = new QueryObserver(f.client, { queryKey: activeKey, enabled: false })
  const detach = observer.subscribe(() => {})
  const create = vi.spyOn(invitationsClient, 'create').mockImplementation(async () => {
    f.access.setAuthority(false)
    return { invitationId: 'invite' } as never
  })
  const list = vi.spyOn(invitationsClient, 'list')
  const detail = vi.spyOn(rolesClient, 'detail')
  f.access.setRefresh(async () => {
    expect(f.client.getQueryState(activeKey)?.isInvalidated).toBe(true)
    expect(f.client.getQueryState(inactiveKey)?.isInvalidated).toBe(true)
    return 'denied'
  })
  const hook = renderHook(() => useInvitationManagerOperations(f.access), { wrapper: f.wrapper })
  await act(async () => {
    expect(
      await hook.result.current.controller.submit({
        kind: 'create',
        input: { email: 'person@example.test', roleIds: ['role'] },
      })
    ).toMatchObject({ status: 'committed', followup: 'denied' })
  })
  expect(f.client.getQueryState(activeKey)?.isInvalidated).toBe(true)
  expect(f.client.getQueryState(inactiveKey)?.isInvalidated).toBe(true)
  expect(create).toHaveBeenCalledOnce()
  expect(list).not.toHaveBeenCalled()
  expect(detail).not.toHaveBeenCalled()
  f.unchanged()
  detach()
})

it.each(['remove-member', 'revoke-key'] as const)(
  'legacy %s invalidates inactive nested key caches before authority refusal',
  async (command) => {
    const f = fixture()
    const query = { expectedMemberId: 'member', page: 1, limit: 20, status: 'all' as const }
    const nestedKey = (session: string) => [
      'member-api-keys',
      JSON.stringify([JSON.stringify([session, 'org', 'user', 'member']), { ...query, page: 2 }]),
    ]
    f.client.setQueryData(nestedKey(binding), { data: [] })
    f.client.setQueryData(nestedKey('another-session'), { data: [] })
    f.client.setQueryData(listKey, { data: [] })
    vi.spyOn(memberKeysClient, 'list').mockResolvedValue({ data: [] } as never)
    const revoke = vi
      .spyOn(memberKeysClient, 'revoke')
      .mockResolvedValue({ revoked: true } as never)
    const remove = vi.spyOn(removalTransport, 'removeMember').mockResolvedValue({ removed: true })
    f.access.setRefresh(async () => 'denied')
    const hook = renderHook(
      () => {
        const removal = useMemberRemoval(f.access, {
          userId: 'user',
          memberId: 'member',
          email: 'person@example.test',
        })
        const keys = useMemberApiKeys(f.access, 'user', query)
        return { removal, keys }
      },
      { wrapper: f.wrapper }
    )
    await waitFor(() => expect(hook.result.current.keys.available).toBe(true))
    await act(async () => {
      const outcome =
        command === 'remove-member'
          ? await hook.result.current.removal.remove()
          : await hook.result.current.keys.revoke('key')
      expect(outcome).toMatchObject({ status: 'committed', followup: 'denied' })
    })
    expect(command === 'remove-member' ? remove : revoke).toHaveBeenCalledOnce()
    expect(f.client.getQueryState(nestedKey(binding))?.isInvalidated).toBe(true)
    expect(f.client.getQueryState(nestedKey('another-session'))?.isInvalidated).toBe(false)
    expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
    f.unchanged()
  }
)

it('legacy authority failure keeps the acknowledgment and closes admission after invalidation', async () => {
  const f = fixture()
  f.client.setQueryData(listKey, { data: [] })
  vi.spyOn(rolesClient, 'create').mockResolvedValue({ role } as never)
  f.access.setRefresh(async () => {
    throw new Error('AUTHORITY_UNAVAILABLE')
  })
  const hook = renderHook(() => useCreateRoleDefinition(f.access), { wrapper: f.wrapper })
  await act(async () => {
    expect(await hook.result.current.create({ name: 'After', description: null })).toMatchObject({
      status: 'committed',
      followup: 'error',
    })
  })
  expect(f.access.allowed()).toBe(false)
  expect(f.client.getQueryState(listKey)?.isInvalidated).toBe(true)
  f.unchanged()
})
