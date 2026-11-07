import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { MemberRolesResponse } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import messages from '../../../../messages/en.json'
const membersClient = vi.hoisted(() => ({ roles: vi.fn(), save: vi.fn() }))
vi.mock('@/entities/organization-context/api/members-client', () => ({ membersClient }))
import { createOrganizationAccessController } from '@/entities/organization-context'

import { MemberRoleDialog } from './role-dialog'

vi.mock('client-only', () => ({}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: 'a' }))
const one = { id: 'one', name: 'MEMBER', description: null, isSystem: true }
const two = { ...one, id: 'two', name: 'VIEWER' }
const snapshot: MemberRolesResponse = {
  member: {
    memberId: 'member',
    user: { id: 'user', name: 'Person', email: 'person@example.test' },
  },
  aclVersion: 1,
  assignedRoleCount: 1,
  assignedRoles: [one],
  editMode: 'editable',
  choices: { data: [one, two], total: 2, page: 1, limit: 20 },
}
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
  vi.restoreAllMocks()
})
function fixture(actorId = 'actor') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  })
  clients.push(client)
  const controller = createOrganizationAccessController('binding', 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
  const roles = vi.spyOn(membersClient, 'roles').mockResolvedValue(snapshot)
  const close = vi.fn()
  const view = render(
    <MemberRoleDialog controller={controller} userId="user" actorId={actorId} onClose={close} />,
    { wrapper }
  )
  return { client, controller, roles, close, ...view }
}
it('actual dialog and form share one initial read; save refreshes the resource and authority', async () => {
  const save = vi.spyOn(membersClient, 'save').mockResolvedValue({
    memberId: 'member',
    userId: 'user',
    organizationId: 'org',
    roleIds: ['one', 'two'],
    aclVersion: 2,
    changed: true,
  })
  const f = fixture()
  f.controller.setRefresh(async () => {
    f.controller.setAuthority(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    f.controller.setAuthority(true)
    return 'ready'
  })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeEnabled())
  expect(f.roles).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('checkbox', { name: 'VIEWER' }))
  f.roles.mockResolvedValue({
    ...snapshot,
    aclVersion: 2,
    assignedRoles: [one, two],
    assignedRoleCount: 2,
  })
  fireEvent.click(screen.getByRole('button', { name: messages.organizationMembers.save }))
  await waitFor(() => expect(f.close).toHaveBeenCalledOnce())
  expect(save).toHaveBeenCalledOnce()
  expect(f.roles).toHaveBeenCalledTimes(2)
})
it('cancelled explicit review keeps the real form selection and expected version', async () => {
  const save = vi.spyOn(membersClient, 'save')
  const f = fixture()
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: 'VIEWER' }))
  const key = [
    'organization-members',
    JSON.stringify([
      'binding',
      'org',
      { userId: 'user', page: 1, search: '', section: 'available' },
    ]),
  ]
  act(() => f.client.setQueryData(key, { ...snapshot, aclVersion: 2 }))
  const review = await screen.findByRole('button', {
    name: messages.organizationMembers.reviewCurrent,
  })
  let signal!: AbortSignal
  let resolve!: (value: MemberRolesResponse) => void
  f.roles.mockImplementation((_b, _o, _u, _q, s) => {
    signal = s
    return new Promise((done) => {
      resolve = done
    })
  })
  fireEvent.click(review)
  await waitFor(() => expect(signal).toBeDefined())
  await act(async () => {
    await f.client.cancelQueries({ queryKey: key })
    resolve({ ...snapshot, aclVersion: 3 })
  })
  await screen.findByText(messages.organizationMembers.reviewFailed)
  expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeChecked()
  expect(screen.getByRole('button', { name: messages.organizationMembers.save })).toBeDisabled()
  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: messages.organizationMembers.save }).closest('form')!
    )
  })
  expect(save).not.toHaveBeenCalled()
})
it('a known retirement blocks actual submit before a delayed render', async () => {
  const save = vi.spyOn(membersClient, 'save')
  const f = fixture()
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'VIEWER' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: 'VIEWER' }))
  await act(async () => {
    f.controller.retire()
    fireEvent.submit(
      screen.getByRole('button', { name: messages.organizationMembers.save }).closest('form')!
    )
  })
  expect(save).not.toHaveBeenCalled()
})

it('self-role loss requires acknowledgment, masks the draft and leaves a working Close', async () => {
  const save = vi.spyOn(membersClient, 'save').mockResolvedValue({
    memberId: 'member',
    userId: 'user',
    organizationId: 'org',
    roleIds: ['one', 'two'],
    aclVersion: 2,
    changed: true,
  })
  const f = fixture('user')
  f.controller.setRefresh(async () => {
    f.controller.setAuthority(false)
    return 'denied'
  })
  await screen.findByRole('checkbox', { name: 'VIEWER' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'VIEWER' }))
  const submit = screen.getByRole('button', { name: messages.organizationMembers.save })
  expect(submit).toBeDisabled()
  fireEvent.submit(submit.closest('form')!)
  await act(async () => {})
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: messages.organizationMembers.selfWarning }))
  fireEvent.click(submit)
  await waitFor(() => expect(f.controller.allowed()).toBe(false))
  expect(save).toHaveBeenCalledOnce()
  expect(screen.queryByRole('checkbox', { name: 'VIEWER' })).not.toBeInTheDocument()
  const close = await screen.findByRole('button', { name: messages.organizationMembers.close })
  expect(close).toBeEnabled()
  fireEvent.click(close)
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.roles).toHaveBeenCalledOnce()
})
