import { type ReactNode, StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

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
