import { QueryClient, QueryObserver, skipToken } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { invitationsClient } from '../api/invitations-client'
import { membersClient } from '../api/members-client'
import { rolesClient } from '../api/roles-client'

import { createOrganizationAccessController } from './access-controller'
import { invitationEffects, memberRoleEffects, refreshOrganizationEffects } from './read-effects'

const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const access = createOrganizationAccessController('binding', 'org')
  access.setAuthority(true)
  return { client, access }
}
const key = (family: string, input: unknown, binding = 'binding') =>
  [family, JSON.stringify([binding, 'org', input])] as const

it.each([
  ['organization-invitations', { page: 1 }, invitationsClient, 'list'],
  ['organization-members', { page: 1 }, membersClient, 'list'],
  ['organization-members', { userId: 'user', page: 1 }, membersClient, 'roles'],
  ['organization-role-definition', 'role', rolesClient, 'detail'],
  ['organization-role-definitions', { page: 1 }, rolesClient, 'list'],
  ['organization-member-access', 'user', rolesClient, 'memberAccess'],
] as const)(
  'refreshes %s through its typed transport despite a legacy skipToken observer',
  async (family, input, transport, method) => {
    const { client, access } = fixture()
    const queryKey = key(family, input)
    client.setQueryData(queryKey, { version: 1 })
    const observer = new QueryObserver(client, { queryKey, queryFn: skipToken, enabled: false })
    const detach = observer.subscribe(() => {})
    const read = vi
      .spyOn(transport as typeof rolesClient, method as 'detail')
      .mockResolvedValue({ version: 2 } as never)
    try {
      expect(await refreshOrganizationEffects(client, access, [family])).toBe('ready')
      expect(read).toHaveBeenCalledOnce()
      expect(read.mock.calls[0]?.slice(0, 2)).toEqual(['binding', 'org'])
      expect(client.getQueryData(queryKey)).toEqual({ version: 2 })
    } finally {
      detach()
    }
  }
)

it('invalidates inactive member dependencies without fetching or touching other sessions', async () => {
  const { client, access } = fixture()
  const keys = memberRoleEffects.map((family) => key(family, 'resource'))
  const other = key('organization-members', {}, 'other-binding')
  const unrelated = key('organization-invitations', {})
  for (const k of [...keys, other, unrelated]) client.setQueryData(k, { version: 1 })
  const read = vi.spyOn(membersClient, 'list')
  expect(await refreshOrganizationEffects(client, access, memberRoleEffects)).toBe('ready')
  for (const k of keys) expect(client.getQueryState(k)?.isInvalidated).toBe(true)
  for (const k of [other, unrelated]) expect(client.getQueryState(k)?.isInvalidated).toBe(false)
  expect(read).not.toHaveBeenCalled()
})

it('invalidates dependencies after self-revocation without rereading forbidden resources', async () => {
  const { client, access } = fixture()
  const queryKey = key('organization-members', { page: 1 })
  client.setQueryData(queryKey, { version: 1 })
  const read = vi.spyOn(membersClient, 'list')
  const observer = new QueryObserver(client, { queryKey, queryFn: skipToken, enabled: false })
  const detach = observer.subscribe(() => {})
  access.setAuthority(false)
  expect(await refreshOrganizationEffects(client, access, memberRoleEffects)).toBe('denied')
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
  expect(read).not.toHaveBeenCalled()
  detach()
})

it('write follow-up respects Retry-After already held by an observed resource', async () => {
  const { client, access } = fixture()
  const queryKey = key('organization-invitations', { page: 1 })
  const failure = new ApiRequestError(429, undefined, 60)
  await expect(
    client.fetchQuery({ queryKey, queryFn: () => Promise.reject(failure) })
  ).rejects.toBe(failure)
  const observer = new QueryObserver(client, { queryKey, queryFn: skipToken, enabled: false })
  const detach = observer.subscribe(() => {})
  const read = vi.spyOn(invitationsClient, 'list')
  await expect(refreshOrganizationEffects(client, access, invitationEffects)).rejects.toBe(failure)
  expect(read).not.toHaveBeenCalled()
  detach()
})

it('cancelling required follow-up cannot turn cached fallback into successful observation', async () => {
  const { client, access } = fixture()
  const queryKey = key('organization-invitations', { page: 1 })
  client.setQueryData(queryKey, { version: 1 })
  const observer = new QueryObserver(client, { queryKey, queryFn: skipToken, enabled: false })
  const detach = observer.subscribe(() => {})
  let resolve!: (value: never) => void
  const read = vi.spyOn(invitationsClient, 'list').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const refresh = refreshOrganizationEffects(client, access, invitationEffects)
  const assertion = expect(refresh).rejects.toThrow()
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  await client.cancelQueries({ queryKey })
  resolve({ version: 2 } as never)
  await assertion
  expect(client.getQueryData(queryKey)).toEqual({ version: 1 })
  detach()
})

it.each(['complete', 'cancel'] as const)(
  'a resumed observer can %s the invalidated follow-up read',
  async (finish) => {
    const { client, access } = fixture()
    const queryKey = key('organization-invitations', { page: 1 })
    client.setQueryData(queryKey, { version: 1 })
    const observer = new QueryObserver(client, { queryKey, queryFn: skipToken, enabled: false })
    const detach = observer.subscribe(() => {})
    let resolve!: (value: never) => void
    const read = vi.spyOn(invitationsClient, 'list').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const refresh = refreshOrganizationEffects(
      client,
      access,
      invitationEffects,
      undefined,
      async () => {
        observer.setOptions({
          queryKey,
          queryFn: ({ signal }) =>
            invitationsClient.list(
              'binding',
              'org',
              { page: 1, limit: 20, status: 'pending', search: '' },
              signal
            ),
          enabled: true,
        })
        return 'ready'
      }
    )
    const assertion =
      finish === 'cancel'
        ? expect(refresh).rejects.toThrow('REFRESH_CANCELLED')
        : expect(refresh).resolves.toBe('ready')
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    if (finish === 'cancel') await client.cancelQueries({ queryKey })
    resolve({ version: 2 } as never)
    await assertion
    expect(read).toHaveBeenCalledOnce()
    expect(client.getQueryData(queryKey)).toEqual({ version: finish === 'cancel' ? 1 : 2 })
    detach()
  }
)
