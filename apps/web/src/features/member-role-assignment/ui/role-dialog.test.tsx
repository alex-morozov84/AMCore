import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useOrganizationContext } from '@/entities/organization-context'
import { ApiRequestError } from '@/shared/api/http-client'

const messages = {
  organizationMembers: {
    edit: 'Edit roles',
    loading: 'Loading',
    readUnavailable: 'Current roles unavailable',
    retry: 'Retry',
    close: 'Close',
  },
  errors: { MEMBER_READ_UNAVAILABLE: 'Read unavailable', UNKNOWN_ERROR: 'Unexpected error' },
}

import { MemberRoleDialog } from './role-dialog'

const rolesLoad = vi.hoisted(() => vi.fn())
vi.mock('@/entities/organization-context/api/members-client', () => ({
  membersClient: { roles: rolesLoad },
}))
vi.mock('@/entities/organization-context/api/context-client', () => ({
  organizationContextClient: {
    bootstrap: async () => ({ binding: 'binding', actor: {} }),
    authority: async () => ({
      binding: 'binding',
      data: { organization: { id: 'org', name: 'Org', slug: 'org' }, canManageTeamAccess: true },
    }),
  },
}))
vi.mock('./role-form', () => ({ MemberRoleForm: () => <p>Snapshot ready</p> }))
afterEach(() => vi.useRealTimers())
async function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  const owner = renderHook(
    () =>
      useOrganizationContext('binding', { kind: 'selected', id: 'org', locale: DEFAULT_LOCALE }),
    { wrapper }
  )
  await act(async () => vi.advanceTimersByTimeAsync(100))
  const controller = owner.result.current.controller
  expect(controller.allowed()).toBe(true)
  const close = vi.fn()
  const rendered = render(
    <MemberRoleDialog controller={controller} userId="user" actorId="actor" onClose={close} />,
    { wrapper }
  )
  return { ...rendered, controller, close }
}
it('settled first503 respects Retry-After, removes loading and can retry to snapshot', async () => {
  vi.useFakeTimers()
  rolesLoad.mockRejectedValueOnce(
    new ApiRequestError(503, { errorCode: 'MEMBER_READ_UNAVAILABLE' } as never, 2)
  )
  const { close } = await view()
  await act(async () => {})
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  const retry = screen.getByRole('button', { name: messages.organizationMembers.retry })
  expect(retry).toBeDisabled()
  expect(screen.getByRole('button', { name: messages.organizationMembers.close })).toBeEnabled()
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(retry).toBeEnabled()
  rolesLoad.mockResolvedValueOnce({
    member: { memberId: 'member', user: { id: 'user', name: 'Name', email: 'user@example.test' } },
  } as never)
  await act(async () => {
    fireEvent.click(retry)
  })
  expect(screen.getByText('Snapshot ready')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
})
it('first deadline settles, Close works, retirement masks late response', async () => {
  vi.useFakeTimers()
  let resolve!: (value: never) => void
  rolesLoad.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { controller, close, unmount } = await view()
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: messages.organizationMembers.retry })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: messages.organizationMembers.close }))
  expect(close).toHaveBeenCalledTimes(1)
  act(() => controller.retire())
  unmount()
  await act(async () => resolve({ member: {} } as never))
  expect(screen.queryByText('Snapshot ready')).not.toBeInTheDocument()
})
