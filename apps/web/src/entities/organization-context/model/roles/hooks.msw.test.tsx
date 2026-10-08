import type { ReactNode } from 'react'
import type { SaveRoleDefinition } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { createOrganizationAccessController } from '../access-controller'

import {
  useCapabilityCatalogue,
  useCreateRoleDefinition,
  useRoleDefinition,
  useRoleDefinitions,
} from './hooks'

vi.mock('client-only', () => ({}))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const binding = 'a'.repeat(64)
const base = '/api/product-access/organizations/org'
const meta = {
  id: 'role-1',
  name: 'Support',
  description: null,
  isSystem: false,
  organizationId: 'org',
}
const detail = {
  role: meta,
  aclVersion: 4,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: { total: 0, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
}
const dto: SaveRoleDefinition = {
  expectedAclVersion: 4,
  name: 'Support',
  description: null,
  presets: [],
}

function setup() {
  const controller = createOrganizationAccessController(binding, 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { controller, wrapper }
}
const envelope = (data: unknown, init?: ResponseInit) => HttpResponse.json({ binding, data }, init)

describe('role-definition hooks', () => {
  it('read the catalogue, the page and one role with the session binding header', async () => {
    const seen: string[] = []
    server.use(
      http.get(`${base}/capabilities`, ({ request }) => {
        seen.push(request.headers.get('x-amcore-context-session') ?? '')
        return envelope({ capabilities: [] })
      }),
      http.get(`${base}/role-definitions`, ({ request }) => {
        seen.push(new URL(request.url).search)
        return envelope({ data: [], total: 0, page: 1, limit: 20, aclVersion: 4 })
      }),
      http.get(`${base}/role-definitions/role-1`, () => envelope(detail))
    )
    const { controller, wrapper } = setup()
    const catalogue = renderHook(() => useCapabilityCatalogue(controller), { wrapper })
    const list = renderHook(() => useRoleDefinitions(controller, { page: 1, search: 'ops' }), {
      wrapper,
    })
    const one = renderHook(() => useRoleDefinition(controller, 'role-1'), { wrapper })
    await waitFor(() => expect(catalogue.result.current.available).toBe(true))
    await waitFor(() => expect(list.result.current.available).toBe(true))
    await waitFor(() => expect(one.result.current.data?.role.id).toBe('role-1'))
    expect(seen[0]).toBe(binding)
    expect(seen.some((s) => s.includes('search=ops') && s.includes('limit=20'))).toBe(true)
  })

  it('a committed save refreshes the registered detail read and reports the follow-up', async () => {
    let reads = 0
    let writes = 0
    server.use(
      http.get(`${base}/role-definitions/role-1`, () => {
        reads += 1
        return envelope({ ...detail, aclVersion: 3 + reads })
      }),
      http.patch(`${base}/role-definitions/role-1`, () => {
        writes += 1
        return envelope({ detail, changed: true })
      })
    )
    const { controller, wrapper } = setup()
    controller.setRefresh(async () => {
      await controller.waitTransports()
      return 'ready'
    })
    const { result } = renderHook(() => useRoleDefinition(controller, 'role-1'), { wrapper })
    await waitFor(() => expect(result.current.available).toBe(true))
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined
    await act(async () => {
      outcome = await result.current.save(dto)
    })
    expect(outcome).toMatchObject({ status: 'committed', followup: 'ready' })
    expect(writes).toBe(1)
    // The follow-up REREAD of the registered detail read actually happened (initial read + refresh).
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2))
    expect(result.current.data?.aclVersion).toBe(3 + reads)
    expect(result.current.busy).toBe(false)
  })

  it('a failed refresh keeps authority ready but the read is no longer available, and it recovers', async () => {
    let failing = false
    server.use(
      http.get(`${base}/role-definitions/role-1`, () =>
        failing
          ? HttpResponse.json({ errorCode: 'ROLE_READ_UNAVAILABLE' }, { status: 503 })
          : envelope(detail)
      )
    )
    const { controller, wrapper } = setup()
    const { result } = renderHook(() => useRoleDefinition(controller, 'role-1'), { wrapper })
    await waitFor(() => expect(result.current.available).toBe(true))
    failing = true
    await act(async () => {
      await controller.refresh().catch(() => undefined)
    })
    // Authority is still ready, yet stale data must not count as the current resource.
    expect(result.current.ready).toBe(true)
    expect(result.current.available).toBe(false)
    expect(result.current.error).toBeDefined()
    failing = false
    await act(async () => {
      await result.current.refresh().catch(() => undefined)
    })
    await waitFor(() => expect(result.current.available).toBe(true))
  })

  it('an unconfirmed save is UNKNOWN and is never replayed; a stable conflict is REJECTED', async () => {
    let writes = 0
    let answer: 'unknown' | 'conflict' = 'unknown'
    server.use(
      http.get(`${base}/role-definitions/role-1`, () => envelope(detail)),
      http.patch(`${base}/role-definitions/role-1`, () => {
        writes += 1
        return answer === 'unknown'
          ? HttpResponse.json({ errorCode: 'ROLE_SAVE_UNAVAILABLE' }, { status: 503 })
          : HttpResponse.json({ errorCode: 'ROLE_DEFINITION_CONFLICT' }, { status: 409 })
      })
    )
    const { controller, wrapper } = setup()
    const { result } = renderHook(() => useRoleDefinition(controller, 'role-1'), { wrapper })
    await waitFor(() => expect(result.current.available).toBe(true))
    let first: Awaited<ReturnType<typeof result.current.save>> | undefined
    await act(async () => {
      first = await result.current.save(dto)
    })
    expect(first).toMatchObject({ status: 'unknown' })
    expect(writes).toBe(1)
    answer = 'conflict'
    let second: Awaited<ReturnType<typeof result.current.save>> | undefined
    await act(async () => {
      second = await result.current.save(dto)
    })
    expect(second).toMatchObject({ status: 'rejected' })
    expect(writes).toBe(2)
  })

  it('create is acknowledged by 201 and a retired lease sends nothing', async () => {
    let writes = 0
    server.use(
      http.post(`${base}/role-definitions`, () => {
        writes += 1
        return envelope(detail, { status: 201 })
      })
    )
    const { controller, wrapper } = setup()
    const { result, unmount } = renderHook(() => useCreateRoleDefinition(controller), { wrapper })
    let outcome: Awaited<ReturnType<typeof result.current.create>> | undefined
    await act(async () => {
      outcome = await result.current.create({ name: 'Support' })
    })
    expect(outcome).toMatchObject({ status: 'committed', result: { role: { id: 'role-1' } } })
    const { create } = result.current
    unmount()
    expect(await create({ name: 'Again' })).toEqual({ status: 'retired' })
    expect(writes).toBe(1)
  })
})
