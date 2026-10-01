import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { contextAffordances } from './context-fixture'
import type { OrganizationContextInput } from './context-input'
import { useOrganizationContext } from './use-organization-context'

vi.mock('client-only', () => ({}))
const binding = 'a'.repeat(64)
const identity = (current = binding) => ({
  binding: current,
  actor: { id: 'actor', email: 'actor@example.test' },
})
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const events: string[] = []
  server.use(
    http.get('/api/product-access/organizations/:id/context', ({ params }) => {
      events.push(`domain:${params.id}`)
      return HttpResponse.json({
        binding,
        data: {
          organization: { id: params.id, name: 'Company', slug: 'company' },
          canManageTeamAccess: true,
          ...contextAffordances,
        },
      })
    })
  )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    ({ input }: { input: OrganizationContextInput }) => useOrganizationContext(binding, input),
    {
      wrapper,
      initialProps: {
        input: { kind: 'selected', id: 'A', locale: 'en' } as OrganizationContextInput,
      },
    }
  )
  return { ...hook, events, client }
}

it.each([false, true])(
  'actual hook retarget during queued focus waits for identity (changed=%s)',
  async (changed) => {
    let resume = false
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: string[] = []
    server.use(
      http.get('/api/product-access/bootstrap', async () => {
        events.push('bootstrap')
        if (resume) await held
        return HttpResponse.json(identity(resume && changed ? 'b'.repeat(64) : binding))
      })
    )
    const f = fixture()
    await waitFor(() => expect(f.result.current.state.status).toBe('ready'))
    events.length = 0
    f.events.length = 0
    resume = true
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    f.rerender({ input: { kind: 'selected', id: 'B', locale: 'ru' } })
    f.rerender({ input: { kind: 'selected', id: 'C', locale: 'en' } })
    expect(f.result.current.data).toBeUndefined()
    await waitFor(() => expect(events).toEqual(['bootstrap']))
    expect(f.events).toEqual([])
    await act(async () => {
      release()
      await pause(10)
    })
    await waitFor(() => expect(f.result.current.state.status).toBe(changed ? 'changed' : 'ready'))
    expect(f.events).toEqual(changed ? [] : ['domain:C'])
    if (changed)
      expect(
        f.client.getQueryData(['organization-context', binding, 'selected:C:en'])
      ).toBeUndefined()
    f.unmount()
    f.client.clear()
  }
)

it.each(['bootstrap', 'domain'])(
  'actual hook %s429 retarget waits for explicit recovery after expiry',
  async (leg) => {
    let limited = true
    const events: string[] = []
    server.use(
      http.get('/api/product-access/bootstrap', () => {
        events.push('bootstrap')
        return limited && leg === 'bootstrap'
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json(identity())
      })
    )
    const f = fixture()
    server.use(
      http.get('/api/product-access/organizations', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        events.push(`list:${page}`)
        return HttpResponse.json({ binding, data: { data: [], total: 0, page, limit: 20 } })
      }),
      http.get('/api/product-access/organizations/:id/context', ({ params }) => {
        events.push(`domain:${params.id}`)
        return limited && leg === 'domain'
          ? HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({
              binding,
              data: {
                organization: { id: params.id, name: 'Latest', slug: 'latest' },
                canManageTeamAccess: true,
                ...contextAffordances,
              },
            })
      })
    )
    await waitFor(() => expect(f.result.current.state.retryAt).toBeDefined())
    events.length = 0
    limited = false
    f.rerender({ input: { kind: 'selected', id: 'B', locale: 'ru' } })
    f.rerender({ input: { kind: 'list', page: 2, locale: 'en' } })
    act(() => {
      f.result.current.refresh()
    })
    await act(async () => {
      await pause(100)
    })
    expect(events).toEqual([])
    expect(f.result.current.data).toBeUndefined()
    await waitFor(() => expect(f.result.current.state.retryAt).toBeUndefined(), { timeout: 2000 })
    expect(events).toEqual([])
    act(() => {
      f.result.current.refresh()
    })
    await waitFor(() => expect(f.result.current.state.status).toBe('ready'))
    expect(events).toEqual(['bootstrap', 'list:2'])
    f.unmount()
    f.client.clear()
  }
)
