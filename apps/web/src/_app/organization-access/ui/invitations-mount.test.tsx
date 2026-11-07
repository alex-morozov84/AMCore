import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import {
  actorAffordancesSchema,
  CAPABILITY_CATALOGUE,
  inviteListResponseSchema,
} from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import type {
  readOrganizationContext,
  readOrganizationInvitations,
} from '@/entities/organization-context/index.server'
const organizationContextClient = vi.hoisted(() => ({ bootstrap: vi.fn(), authority: vi.fn() }))
vi.mock('@/entities/organization-context/api/context-client', () => ({ organizationContextClient }))
import { invitationsClient } from '@/entities/organization-context'
const contextAffordances = {
  actorAffordances: actorAffordancesSchema.parse({
    ...Object.fromEntries(CAPABILITY_CATALOGUE.map(({ id }) => [id, 'denied'])),
    'teamAccess.manage': 'allowed',
    'organization.read': 'allowed',
    'organization.update': 'recordRequired',
    'organization.delete': 'recordRequired',
  }),
  recordAffordances: {
    'organization.read': { allowed: true, fields: {} },
    'organization.update': { allowed: false, fields: { name: false, slug: false } },
    'organization.delete': { allowed: false, fields: {} },
  },
} as const
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { ApiRequestError } from '@/shared/api/http-client'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import en from '../../../../messages/en.json'

import { OrganizationInvitationsMount } from './invitations-mount'
const mocks = vi.hoisted(() => ({
  seed: vi.fn<typeof readOrganizationInvitations>(),
  context: vi.fn<typeof readOrganizationContext>(),
}))
vi.mock('server-only', () => ({}))
vi.mock('client-only', () => ({}))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/i18n/navigation', () => ({ Link: 'a', usePathname: () => '/' }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'opaque-fixture' }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  },
}))
vi.mock('@/shared/api/bff/dal', () => ({
  redirectToLogin: () => {
    throw new Error('login')
  },
}))
vi.mock('../model/admission.server', () => ({
  safeOrganizationAdmission: async () => ({
    binding: 'a'.repeat(64),
    actor: { id: 'actor', email: 'actor@example.test' },
  }),
}))
vi.mock('@/entities/organization-context/index.server', async () => ({
  ...(await import('@/entities/organization-context')),
  readOrganizationContext: mocks.context,
  readOrganizationInvitations: mocks.seed,
}))
vi.mock('@/i18n/client-message-boundary', () => ({
  ClientMessages: ({ children }: { children: ReactNode }) => children,
}))
const empty = {
  binding: 'a'.repeat(64),
  data: { data: [], total: 0, page: 1, limit: 20 },
} satisfies Awaited<ReturnType<typeof readOrganizationInvitations>>
const populated = {
  binding: 'a'.repeat(64),
  data: {
    data: [
      {
        id: 'invite-1',
        email: 'guest@example.test',
        generation: 1,
        issuedAt: '2026-11-01T00:00:00Z',
        issuedAtEstimated: false,
        expiresAt: '2026-12-01T00:00:00Z',
        status: 'pending' as const,
        intentValid: true,
        roles: [],
      },
    ],
    total: 21,
    page: 1,
    limit: 20,
  },
} satisfies Awaited<ReturnType<typeof readOrganizationInvitations>>
beforeEach(() => {
  mocks.seed.mockReset().mockResolvedValue(empty)
  mocks.context.mockReset().mockResolvedValue({
    binding: 'a'.repeat(64),
    data: {
      organization: { id: 'org', name: 'Org', slug: 'org' },
      canManageTeamAccess: true,
      ...contextAffordances,
    },
  })
})
it.each([empty, populated])(
  'typed server envelope reaches the actual page/widget with hydrated Query: %j',
  async (envelope) => {
    expect(inviteListResponseSchema.safeParse(envelope.data).success).toBe(true)
    mocks.seed.mockResolvedValue(envelope)
    const bootstrap = vi
      .spyOn(organizationContextClient, 'bootstrap')
      .mockImplementation(() => new Promise(() => {}))
    const read = vi.spyOn(invitationsClient, 'list')
    const create = vi.spyOn(invitationsClient, 'create')
    try {
      const result = await OrganizationInvitationsMount({ id: 'org' })
      expect(mocks.seed).toHaveBeenCalledWith(
        'org',
        expect.objectContaining({ page: 1, limit: 20 }),
        expect.objectContaining({ expectedSession: 'a'.repeat(64), headers: expect.any(Headers) })
      )
      expect(JSON.stringify(result.props.children.props)).not.toContain('opaque-fixture')
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 60000 } },
      })
      render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
          <QueryClientProvider client={client}>{result}</QueryClientProvider>
        </NextIntlClientProvider>
      )
      if (envelope.data.data.length) {
        expect(screen.queryAllByText('guest@example.test').length).toBeGreaterThan(0)
        expect(screen.queryByText('Page 1 of 2')).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: en.organizationInvitations.next })
        ).toBeInTheDocument()
      } else expect.soft(screen.queryByText(en.organizationInvitations.empty)).toBeInTheDocument()
      const invite = screen.getByRole('button', { name: en.organizationInvitations.invite })
      expect(invite).toBeEnabled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(read).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    } finally {
      bootstrap.mockRestore()
      read.mockRestore()
      create.mockRestore()
    }
  }
)
it('an open revoke stays blocked after a failed background read and returns focus safely', async () => {
  mocks.seed.mockResolvedValue(populated)
  const bootstrap = vi
    .spyOn(organizationContextClient, 'bootstrap')
    .mockImplementation(() => new Promise(() => {}))
  const read = vi
    .spyOn(invitationsClient, 'list')
    .mockRejectedValue(new ApiRequestError(503, undefined))
  const revoke = vi.spyOn(invitationsClient, 'revoke')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = await OrganizationInvitationsMount({ id: 'org' })
  const view = render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <QueryClientProvider client={client}>{page}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  try {
    const user = userEvent.setup()
    const t = en.organizationInvitations
    const action = (name: string) =>
      t.actionFor.replace('{action}', name).replace('{email}', 'guest@example.test')
    const row = screen.getByRole('row', { name: /guest@example.test/ })
    await user.click(within(row).getByRole('button', { name: action(t.actions) }))
    await user.click(await screen.findByRole('menuitem', { name: action(t.revoke) }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(dialog.getByRole('button', { name: t.revoke })).toBeEnabled()
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['organization-invitations'] })
    })
    await waitFor(() => expect(dialog.getByRole('button', { name: t.revoke })).toBeDisabled())
    expect(read).toHaveBeenCalledOnce()
    expect(dialog.getByText(t.checking)).toBeVisible()
    expect(revoke).not.toHaveBeenCalled()
    await user.click(dialog.getByRole('button', { name: t.cancel }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: t.search })).toHaveFocus())
  } finally {
    view.unmount()
    client.clear()
    bootstrap.mockRestore()
    read.mockRestore()
    revoke.mockRestore()
  }
})
it.each([401, 403, 404])('thrown seed refusal %s never mounts dependent client', async (status) => {
  mocks.seed.mockRejectedValue(new ContextRequestError(status, 'FORBIDDEN'))
  await expect(OrganizationInvitationsMount({ id: 'org' })).rejects.toThrow(
    status === 401 ? 'login' : 'not-found'
  )
})
it.each([429, 503, 504])('thrown seed unavailable %s returns server fallback', async (status) => {
  mocks.seed.mockRejectedValue(new ContextRequestError(status, 'SERVICE_UNAVAILABLE'))
  const result = await OrganizationInvitationsMount({ id: 'org' })
  expect(result.type).toBe(PrimaryUnavailableFallback)
})
it.each([
  new ContextRequestError(409, 'CONTEXT_SESSION_CHANGED'),
  new ContextRequestError(502, 'INVALID_RESPONSE'),
  new Error('unexpected'),
])('thrown DAL failure is propagated (not malformed-success validation): %s', async (error) => {
  mocks.seed.mockRejectedValue(error)
  await expect(OrganizationInvitationsMount({ id: 'org' })).rejects.toBe(error)
})
