import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { organizationContextClient } from '../api/context-client'

import { createOrganizationAccessController } from './access-controller'
import { contextAffordances } from './context-fixture'
import { useOrganizationContext } from './use-organization-context'
import { useOrganizationRead } from './use-organization-read'

function fixture() {
  const controller = createOrganizationAccessController('binding', 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { controller, wrapper }
}
describe('current primary availability and independent secondary failure', () => {
  it('one completed write refreshes the mounted domain reader only once', async () => {
    const { wrapper } = fixture()
    const binding = 'a'.repeat(64)
    const input = { kind: 'selected' as const, id: 'org', locale: 'en' as const }
    const bootstrap = vi.spyOn(organizationContextClient, 'bootstrap').mockResolvedValue({
      binding,
      actor: { id: 'actor', email: 'actor@example.test' },
    })
    const authority = vi.spyOn(organizationContextClient, 'authority').mockResolvedValue({
      binding,
      data: {
        organization: { id: 'org', name: 'Organization', slug: 'organization' },
        canManageTeamAccess: true,
        ...contextAffordances,
      },
    })
    const load = vi.fn(async () => ({ rows: ['owned'] }))
    try {
      const { result } = renderHook(
        () => {
          const context = useOrganizationContext(binding, input)
          const read = useOrganizationRead(context.controller, 'mounted-domain', load)
          return { context, read }
        },
        { wrapper }
      )
      await waitFor(() => expect(result.current.read.available).toBe(true))
      expect(load).toHaveBeenCalledTimes(1)
      await act(async () => {
        await result.current.context.controller.execute('owned-write', async () => ({
          saved: true,
        }))
      })
      await waitFor(() => expect(result.current.read.available).toBe(true))
      expect(load).toHaveBeenCalledTimes(2)
      expect(bootstrap).toHaveBeenCalledTimes(2)
      expect(authority).toHaveBeenCalledTimes(2)
    } finally {
      bootstrap.mockRestore()
      authority.mockRestore()
    }
  })

  it('cached success is unavailable during pending or failed primary refresh', async () => {
    const { controller, wrapper } = fixture()
    const load = vi.fn().mockResolvedValue({ rows: ['owned'] })
    const { result } = renderHook(() => useOrganizationRead(controller, 'primary', load), {
      wrapper,
    })
    await waitFor(() => expect(result.current.available).toBe(true))
    let reject!: (error: Error) => void
    load.mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no
        })
    )
    let refresh!: Promise<unknown>
    act(() => {
      refresh = result.current.refresh()
      void refresh.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.pending).toBe(true))
    expect(result.current.ready).toBe(true)
    expect(result.current.available).toBe(false)
    expect(result.current.data).toEqual({ rows: ['owned'] })
    await act(async () => {
      reject(new Error('unavailable'))
      await refresh.catch(() => undefined)
    })
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.available).toBe(false)
  })
  it('secondary failure is visible locally but cannot poison primary write followup', async () => {
    const { controller, wrapper } = fixture()
    const failure = new Error('secondary unavailable')
    const { result } = renderHook(
      () => ({
        list: useOrganizationRead(controller, 'list', async () => ({ rows: [] })),
        roles: useOrganizationRead(
          controller,
          'roles',
          async () => {
            throw failure
          },
          { namespace: 'roles', timeoutMs: 1000, secondary: true }
        ),
      }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.roles.error).toBe(failure))
    let outcome!: Awaited<ReturnType<typeof controller.execute>>
    await act(async () => {
      outcome = await controller.execute('owned-row', async () => ({ status: 'revoked' }))
    })
    expect(outcome).toEqual({
      status: 'committed',
      result: { status: 'revoked' },
      followup: 'ready',
    })
    expect(controller.allowed()).toBe(true)
    expect(result.current.list.available).toBe(true)
    expect(result.current.roles.available).toBe(false)
    expect(result.current.roles.error).toBe(failure)
  })
})
