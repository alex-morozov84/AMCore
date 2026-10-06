import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createOrganizationAccessController } from './access-controller'
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
