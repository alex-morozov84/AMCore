import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { inviteListResponseSchema } from '@amcore/shared'
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

import { useOrganizationInvitations } from './hooks'

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
const empty = inviteListResponseSchema.parse({
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
})
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
beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(organizationContextClient, 'bootstrap').mockResolvedValue({
    binding,
    actor: { id: 'actor', email: 'actor@example.test' },
  })
  vi.spyOn(organizationContextClient, 'authority').mockResolvedValue(context)
  vi.spyOn(invitationsClient, 'list').mockResolvedValue(empty)
  vi.spyOn(invitationsClient, 'create').mockResolvedValue({ status: 'invited' })
  vi.spyOn(invitationsClient, 'reissue').mockResolvedValue({ status: 'invited' })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
  vi.restoreAllMocks()
  sessionStorage.clear()
})

it('D1 a resource refusal invalidates cached admission before a new owner mounts', async () => {
  const f = fixture()
  const mount = () =>
    renderHook(
      () => {
        const ctx = cachedContext(binding, input, true)
        return { ctx, list: useOrganizationInvitations(ctx.controller, params) }
      },
      { wrapper: f.wrapper }
    )
  const first = mount()
  await waitFor(() => expect(first.result.current.list.available).toBe(true))
  vi.mocked(invitationsClient.list).mockRejectedValue(
    new ApiRequestError(403, { errorCode: 'FORBIDDEN' } as never)
  )
  await act(async () => {
    await first.result.current.list.refresh().catch(() => undefined)
  })
  await waitFor(() => expect(first.result.current.ctx.controller.allowed()).toBe(false))
  first.unmount()
  const second = mount()
  expect(second.result.current.ctx.controller.allowed()).toBe(false)
})
