import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import {
  type InviteListItem,
  inviteListResponseSchema,
  inviteRoleChoicesResponseSchema,
} from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import messages from '../../../../../messages/en.json'
import { organizationContextClient } from '../../api/context-client'
import { invitationsClient } from '../../api/invitations-client'
import { createOrganizationAccessController } from '../access-controller'
import { contextAffordances } from '../context-fixture'
import { organizationContextKey } from '../context-input'
import { useOrganizationContext } from '../use-organization-context'

import { useInvitationManagerOperations, useOrganizationInvitations } from './hooks'

vi.mock('client-only', () => ({}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: 'a' }))
vi.mock('@/i18n/navigation', () => ({
  Link: 'a',
  usePathname: () => '/en/manage/organizations/org/invites',
}))
const binding = 'a'.repeat(64)
const input = { kind: 'selected' as const, id: 'org', locale: 'en' }
const params = { page: 1, search: '', status: 'pending' as const, limit: 20 }
const listKey = ['organization-invitations', JSON.stringify([binding, 'org', params])]
const context = {
  binding,
  data: {
    organization: { id: 'org', name: 'Example', slug: 'example' },
    canManageTeamAccess: true,
    ...contextAffordances,
  },
}
const role = { id: 'member', name: 'MEMBER', description: null, isSystem: true }
const secondRole = { ...role, id: 'viewer', name: 'VIEWER' }
const choices = inviteRoleChoicesResponseSchema.parse({
  data: [role, secondRole],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
  defaultRole: role,
})
const empty = inviteListResponseSchema.parse({
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
})
const item: InviteListItem = {
  id: 'invite',
  email: 'recipient@example.test',
  generation: 1,
  issuedAt: '2026-11-06T00:00:00Z',
  issuedAtEstimated: false,
  expiresAt: '2026-11-13T00:00:00Z',
  status: 'pending',
  intentValid: true,
  roles: [
    {
      requestedRoleId: 'member',
      id: 'member',
      nameAtIssue: 'MEMBER',
      name: 'MEMBER',
      description: null,
    },
  ],
}
const populated = { ...empty, data: [item], total: 1, totalPages: 1 }
const clients: QueryClient[] = []
const cachedContext = useOrganizationContext as (
  b: string,
  i: typeof input,
  reuse?: boolean
) => ReturnType<typeof useOrganizationContext>
function fixture(seed = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60000, retry: false } },
  })
  clients.push(client)
  if (seed) {
    client.setQueryData(organizationContextKey(binding, input), context)
    client.setQueryData(listKey, empty)
  }
  const access = createOrganizationAccessController(binding, 'org')
  access.setAuthority(true)
  access.setRefresh(async () => 'ready')
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
  return { client, access, wrapper }
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(organizationContextClient, 'bootstrap').mockResolvedValue({
    binding,
    actor: { id: 'actor', email: 'actor@example.test' },
  })
  vi.spyOn(organizationContextClient, 'authority').mockResolvedValue(context)
  vi.spyOn(invitationsClient, 'list').mockResolvedValue(empty)
  vi.spyOn(invitationsClient, 'roles').mockResolvedValue(choices)
  vi.spyOn(invitationsClient, 'create').mockResolvedValue({ status: 'invited' })
  vi.spyOn(invitationsClient, 'reissue').mockResolvedValue({ status: 'invited' })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
  vi.restoreAllMocks()
  sessionStorage.clear()
})

it('S1 fresh server cache provides visible data and action readiness without browser revalidation', async () => {
  const f = fixture()
  const h = renderHook(
    () => {
      const context = cachedContext(binding, input, true)
      return { context, list: useOrganizationInvitations(context.controller, params) }
    },
    { wrapper: f.wrapper }
  )
  expect(h.result.current.list.data).toEqual(empty)
  expect(h.result.current.context.controller.allowed()).toBe(true)
  expect(h.result.current.list.available).toBe(true)
  await act(async () => {
    await Promise.resolve()
  })
  expect(invitationsClient.list).not.toHaveBeenCalled()
  expect(organizationContextClient.bootstrap).not.toHaveBeenCalled()
  expect(organizationContextClient.authority).not.toHaveBeenCalled()
})
it('S2 revoked authority cannot return through an otherwise fresh cached page', async () => {
  const f = fixture()
  const first = renderHook(() => cachedContext(binding, input, true), { wrapper: f.wrapper })
  vi.mocked(organizationContextClient.authority).mockRejectedValue(
    new ApiRequestError(403, { errorCode: 'FORBIDDEN' } as never)
  )
  await act(async () => {
    await first.result.current.refresh()
  })
  expect(first.result.current.controller.allowed()).toBe(false)
  first.unmount()
  const next = renderHook(() => cachedContext(binding, input, true), { wrapper: f.wrapper })
  expect(next.result.current.controller.allowed()).toBe(false)
  expect(next.result.current.data).toBeUndefined()
})
it('S3 persisted-page restoration revokes action permission synchronously before revalidation', async () => {
  const f = fixture()
  const h = renderHook(() => cachedContext(binding, input, true), { wrapper: f.wrapper })
  await waitFor(() => expect(h.result.current.controller.allowed()).toBe(true))
  const old = h.result.current.controller
  act(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(old.allowed()).toBe(false)
  })
  await waitFor(() => expect(h.result.current.controller.allowed()).toBe(true))
})
it('S4 changed session cannot publish old rows or permit a command', async () => {
  const f = fixture()
  const h = renderHook(
    () => {
      const ctx = cachedContext(binding, input, true)
      return { ctx, list: useOrganizationInvitations(ctx.controller, params) }
    },
    { wrapper: f.wrapper }
  )
  vi.mocked(organizationContextClient.bootstrap).mockResolvedValue({
    binding: 'b'.repeat(64),
    actor: { id: 'other', email: 'other@example.test' },
  })
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await waitFor(() => expect(h.result.current.ctx.state.status).toBe('changed'))
  expect(h.result.current.ctx.controller.allowed()).toBe(false)
  expect(h.result.current.list.available).toBe(false)
  expect(h.result.current.ctx.data).toBeUndefined()
})
it('R1 independent owners share one pending resource request and detaching one preserves the peer', async () => {
  const f = fixture(false)
  const pending = deferred<typeof empty>()
  let signal!: AbortSignal
  vi.mocked(invitationsClient.list).mockImplementation((_b, _o, _q, s) => {
    signal = s
    return pending.promise
  })
  const peer = createOrganizationAccessController(binding, 'org')
  peer.setAuthority(true)
  const a = renderHook(() => useOrganizationInvitations(f.access, params), { wrapper: f.wrapper })
  const b = renderHook(() => useOrganizationInvitations(peer, params), { wrapper: f.wrapper })
  await waitFor(() => expect(invitationsClient.list).toHaveBeenCalledTimes(1))
  a.unmount()
  expect(signal.aborted).toBe(false)
  await act(async () => {
    pending.resolve(populated)
    await pending.promise
  })
  await waitFor(() => expect(b.result.current.data).toEqual(populated))
})
it('R2 cancelled background read retains the previous result without replacing a draft', async () => {
  const f = fixture()
  const pending = deferred<typeof empty>()
  let signal!: AbortSignal
  const h = renderHook(() => useOrganizationInvitations(f.access, params), { wrapper: f.wrapper })
  await waitFor(() => expect(h.result.current.available).toBe(true))
  vi.mocked(invitationsClient.list).mockImplementation((_b, _o, _q, s) => {
    signal = s
    return pending.promise
  })
  act(() => {
    void h.result.current.refresh().catch(() => undefined)
  })
  await waitFor(() => expect(signal).toBeDefined())
  expect(h.result.current.available).toBe(true)
  await act(async () => {
    await f.client.cancelQueries({ queryKey: listKey })
    pending.resolve(populated)
    await pending.promise
  })
  expect(signal.aborted).toBe(true)
  expect(f.client.getQueryData(listKey)).toEqual(empty)
})
it('R3 Retry-After survives remount, re-enable and explicit retry', async () => {
  const f = fixture(false)
  vi.mocked(invitationsClient.list).mockRejectedValue(
    new ApiRequestError(429, { errorCode: 'RATE_LIMIT_EXCEEDED' } as never, 60)
  )
  const a = renderHook(() => useOrganizationInvitations(f.access, params), { wrapper: f.wrapper })
  await waitFor(() => expect(a.result.current.error).toBeTruthy())
  a.unmount()
  const b = renderHook(() => useOrganizationInvitations(f.access, params), { wrapper: f.wrapper })
  act(() => f.access.setAuthority(false))
  act(() => f.access.setAuthority(true))
  await act(async () => {
    await expect(b.result.current.refresh()).rejects.toBeTruthy()
  })
  expect(invitationsClient.list).toHaveBeenCalledTimes(1)
})
it('W1 a confirmed write replaces a pre-write read and invalidates dependent role detail only', async () => {
  const f = fixture()
  const pending = deferred<typeof empty>()
  let signal!: AbortSignal
  const detailKey = ['organization-role-definition', JSON.stringify([binding, 'org', 'member'])]
  const unrelatedKey = ['organization-members', JSON.stringify([binding, 'org', { page: 1 }])]
  f.client.setQueryData(detailKey, { liveInvitationCount: 0 })
  f.client.setQueryData(unrelatedKey, { rows: [] })
  const h = renderHook(
    () => ({
      list: useOrganizationInvitations(f.access, params),
      operation: useInvitationManagerOperations(f.access),
    }),
    { wrapper: f.wrapper }
  )
  await waitFor(() => expect(h.result.current.list.available).toBe(true))
  vi.mocked(invitationsClient.list)
    .mockImplementationOnce((_b, _o, _q, s) => {
      signal = s
      return pending.promise
    })
    .mockResolvedValue(populated)
  act(() => {
    void h.result.current.list.refresh().catch(() => undefined)
  })
  await waitFor(() => expect(signal).toBeDefined())
  await act(async () => {
    expect(
      await h.result.current.operation.controller.submit({
        kind: 'create',
        input: { email: item.email, roleIds: ['member'] },
      })
    ).toMatchObject({ status: 'committed', followup: 'ready' })
  })
  expect(signal.aborted).toBe(true)
  await act(async () => {
    pending.resolve(empty)
    await pending.promise
  })
  await waitFor(() => expect(h.result.current.list.data).toEqual(populated))
  expect(f.client.getQueryState(detailKey)?.isInvalidated).toBe(true)
  expect(f.client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
  expect(organizationContextClient.bootstrap).not.toHaveBeenCalled()
})
it('W2 refresh failure preserves acknowledged success and permits a read-only recovery', async () => {
  const f = fixture()
  const h = renderHook(
    () => ({
      list: useOrganizationInvitations(f.access, params),
      operation: useInvitationManagerOperations(f.access),
    }),
    { wrapper: f.wrapper }
  )
  await waitFor(() => expect(h.result.current.list.available).toBe(true))
  vi.mocked(invitationsClient.list).mockRejectedValue(
    new ApiRequestError(503, { errorCode: 'SERVICE_UNAVAILABLE' } as never)
  )
  await act(async () => {
    expect(
      await h.result.current.operation.controller.submit({
        kind: 'create',
        input: { email: item.email, roleIds: ['member'] },
      })
    ).toMatchObject({ status: 'committed', followup: 'error' })
  })
  expect(f.access.allowed()).toBe(true)
  vi.mocked(invitationsClient.list).mockResolvedValue(populated)
  await act(async () => {
    expect(await h.result.current.operation.controller.review()).toBe(true)
  })
  await waitFor(() => expect(h.result.current.list.data).toEqual(populated))
  expect(invitationsClient.create).toHaveBeenCalledTimes(1)
})
it('W3 unknown write restores its receipt without issuing a second command', async () => {
  const f = fixture()
  vi.mocked(invitationsClient.create).mockRejectedValue(new TypeError('lost response'))
  const receipt = vi
    .spyOn(invitationsClient, 'receipt')
    .mockResolvedValue({ state: 'committed', kind: 'create', result: { status: 'invited' } })
  const h = renderHook(() => useInvitationManagerOperations(f.access), { wrapper: f.wrapper })
  await act(async () => {
    await h.result.current.controller.submit({
      kind: 'create',
      input: { email: item.email, roleIds: ['member'] },
    })
  })
  expect(h.result.current.status).toBe('unknown')
  const operationId = h.result.current.record!.operationId
  await act(async () => {
    await h.result.current.controller.recover()
  })
  expect(h.result.current.status).toBe('committed')
  expect(invitationsClient.create).toHaveBeenCalledTimes(1)
  expect(receipt.mock.calls[0]![2]).toBe(operationId)
})
it('R4 a known access refusal disables commands before deferred Query observers render', async () => {
  const f = fixture()
  const h = renderHook(() => useOrganizationInvitations(f.access, params), { wrapper: f.wrapper })
  await waitFor(() => expect(h.result.current.available).toBe(true))
  vi.mocked(invitationsClient.list).mockRejectedValue(
    new ApiRequestError(403, { errorCode: 'FORBIDDEN' } as never)
  )
  await act(async () => {
    await expect(h.result.current.refresh()).rejects.toBeTruthy()
    expect(f.access.allowed()).toBe(false)
  })
})

it('R5 a shared refusal reaches the remaining owner after its request initiator detaches', async () => {
  const f = fixture(false)
  let reject!: (error: Error) => void
  vi.mocked(invitationsClient.list).mockImplementation(
    () =>
      new Promise((_yes, no) => {
        reject = no
      })
  )
  const peer = createOrganizationAccessController(binding, 'org')
  peer.setAuthority(true)
  const first = renderHook(() => useOrganizationInvitations(f.access, params), {
    wrapper: f.wrapper,
  })
  const second = renderHook(() => useOrganizationInvitations(peer, params), { wrapper: f.wrapper })
  await waitFor(() => expect(reject).toBeDefined())
  first.unmount()
  f.access.retire()
  await act(async () => {
    reject(new ApiRequestError(403, { errorCode: 'FORBIDDEN' } as never))
    await Promise.resolve()
    await Promise.resolve()
  })
  await waitFor(() => expect(second.result.current.error).toBeTruthy())
  expect(peer.allowed()).toBe(false)
})
