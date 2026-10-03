import { type ReactNode, StrictMode } from 'react'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { organizationContextClient } from '../api/context-client'

import { contextAffordances } from './context-fixture'
import type { OrganizationContextInput } from './context-input'
import { useOrganizationContext } from './use-organization-context'

vi.mock('client-only', () => ({}))
const binding = 'a'.repeat(64)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('actual disabled Query observers and browser resume events preserve ordered counts under StrictMode', async () => {
  const events: string[] = []
  let liveBinding = binding
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  server.use(
    http.get('/api/product-access/bootstrap', () => {
      events.push('bootstrap')
      return HttpResponse.json({
        binding: liveBinding,
        actor: { id: 'actor', email: 'actor@example.test' },
      })
    }),
    http.get('/api/product-access/organizations/:id/context', ({ params, request }) => {
      events.push(`context:${params.id}`)
      expect(request.headers.get('x-amcore-context-session')).toBe(binding)
      return HttpResponse.json({
        binding,
        data: {
          organization: { id: params.id, name: `Company ${params.id}`, slug: String(params.id) },
          canManageTeamAccess: true,
          ...contextAffordances,
        },
      })
    })
  )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  )
  const { result, rerender, unmount } = renderHook(
    ({ input }: { input: OrganizationContextInput }) => useOrganizationContext(binding, input),
    {
      wrapper,
      initialProps: {
        input: { kind: 'selected', id: 'A', locale: 'en' } as OrganizationContextInput,
      },
    }
  )
  await waitFor(() => expect(result.current.state.status).toBe('ready'))
  expect(events).toEqual(['bootstrap', 'context:A'])
  act(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  expect(result.current.data).toBeUndefined()
  await waitFor(() => expect(result.current.state.status).toBe('ready'))
  expect(events).toEqual(['bootstrap', 'context:A', 'bootstrap', 'context:A'])
  rerender({ input: { kind: 'selected', id: 'B', locale: 'ru' } })
  await waitFor(() => expect(result.current.state.status).toBe('ready'))
  expect(events.at(-1)).toBe('context:B')
  expect(events.filter((event) => event === 'bootstrap')).toHaveLength(2)
  liveBinding = 'b'.repeat(64)
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(result.current.state.status).toBe('changed'))
  expect(result.current.data).toBeUndefined()
  expect(events).toHaveLength(6)
  expect(events.at(-1)).toBe('bootstrap')
  unmount()
  client.clear()
})

it('owner callback ignores old refresh settlement after new target authority is established', async () => {
  const data = (id: string) => ({
    binding,
    data: {
      organization: { id, name: id, slug: id },
      canManageTeamAccess: true,
      ...contextAffordances,
    },
  })
  const bootstrap = vi
    .spyOn(organizationContextClient, 'bootstrap')
    .mockResolvedValue({ binding, actor: { id: 'actor', email: 'actor@example.test' } })
  let release!: (v: ReturnType<typeof data>) => void
  let entered!: () => void
  const started = new Promise<void>((done) => {
    entered = done
  })
  const old = new Promise<ReturnType<typeof data>>((done) => {
    release = done
  })
  const authority = vi.spyOn(organizationContextClient, 'authority').mockResolvedValue(data('A'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    ({ id }) => useOrganizationContext(binding, { kind: 'selected', id, locale: DEFAULT_LOCALE }),
    { wrapper, initialProps: { id: 'A' } }
  )
  try {
    await waitFor(() => expect(hook.result.current.controller.allowed()).toBe(true))
    authority.mockImplementationOnce(() => {
      entered()
      return old
    })
    let saving!: ReturnType<typeof hook.result.current.controller.save>
    act(() => {
      saving = hook.result.current.controller.save('member', async () => ({
        memberId: 'member',
        userId: 'user',
        organizationId: 'A',
        roleIds: [],
        aclVersion: 2,
        changed: true,
      }))
    })
    await started
    authority.mockResolvedValue(data('B'))
    hook.rerender({ id: 'B' })
    await waitFor(() =>
      expect(hook.result.current.data?.data).toMatchObject({ organization: { id: 'B' } })
    )
    expect(hook.result.current.controller.allowed()).toBe(true)
    await act(async () => {
      release(data('A'))
      expect(await saving).toEqual({ status: 'retired' })
    })
    expect(hook.result.current.controller.allowed()).toBe(true)
    expect(hook.result.current.controller.isBusy()).toBe(false)
  } finally {
    hook.unmount()
    client.clear()
    bootstrap.mockRestore()
    authority.mockRestore()
  }
})
