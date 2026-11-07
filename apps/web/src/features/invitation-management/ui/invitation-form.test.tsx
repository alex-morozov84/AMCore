import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { type InviteListItem, inviteRoleChoicesResponseSchema } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import {
  createOrganizationAccessController,
  invitationsClient,
  useInvitationManagerOperations,
  useInvitationRoleChoices,
} from '@/entities/organization-context'

import messages from '../../../../messages/en.json'

import { InvitationForm } from './invitation-form'
vi.mock('client-only', () => ({}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: 'a' }))
const role = { id: 'member', name: 'MEMBER', description: null, isSystem: true }
const choices = inviteRoleChoicesResponseSchema.parse({
  data: [role, { ...role, id: 'viewer', name: 'VIEWER' }],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
  defaultRole: role,
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
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
  vi.restoreAllMocks()
  sessionStorage.clear()
})
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  })
  clients.push(client)
  const access = createOrganizationAccessController('a'.repeat(64), 'org')
  access.setAuthority(true)
  access.setRefresh(async () => 'ready')
  vi.spyOn(invitationsClient, 'roles').mockResolvedValue(choices)
  vi.spyOn(invitationsClient, 'reissue').mockResolvedValue({ status: 'invited' })
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
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
it('F1 actual form retains selection through cancelled role refresh and checks confirmation at submit', async () => {
  const f = fixture()
  const pending = deferred<typeof choices>()
  const h = renderHook(
    () => ({
      operation: useInvitationManagerOperations(f.access),
      roles: useInvitationRoleChoices(f.access, { page: 1, limit: 20, search: '' }),
    }),
    { wrapper: f.wrapper }
  )
  await waitFor(() => expect(h.result.current.roles.data).toEqual(choices))
  const form = render(
    <InvitationForm
      access={f.access}
      operations={h.result.current.operation.controller}
      mode="replace"
      initial={item}
      current={item}
      disabled={false}
      onClose={() => undefined}
    />,
    { wrapper: f.wrapper }
  )
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: 'VIEWER' }))
  expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeChecked()
  vi.mocked(invitationsClient.roles).mockReturnValue(pending.promise)
  act(() => {
    void h.result.current.roles.refresh().catch(() => undefined)
  })
  await act(async () => {
    await f.client.cancelQueries({ queryKey: ['organization-invitation-roles'] })
    pending.resolve(choices)
    await pending.promise
  })
  expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeChecked()
  await act(async () => {
    fireEvent.submit(form.container.querySelector('form')!)
  })
  expect(invitationsClient.reissue).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('checkbox', { name: messages.organizationInvitations.reissueConfirmation })
  )
  await act(async () => {
    fireEvent.submit(form.container.querySelector('form')!)
  })
  await waitFor(() => expect(invitationsClient.reissue).toHaveBeenCalledTimes(1))
  expect(vi.mocked(invitationsClient.reissue).mock.calls[0]![4]).toEqual({
    mode: 'replace',
    expectedGeneration: 1,
    roleIds: ['member', 'viewer'],
  })
})
