import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getBackendAccessToken } from '@/shared/api/server/access-token'

import { proxyConsoleAccessProbe } from './access-probe'

vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: vi.fn() }))

const mockedAccessToken = vi.mocked(getBackendAccessToken)

describe('proxyConsoleAccessProbe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails closed without a server-held bearer credential', async () => {
    mockedAccessToken.mockResolvedValue(null)

    const response = await proxyConsoleAccessProbe()

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('')
  })

  it('forwards only the no-content success status', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const response = await proxyConsoleAccessProbe()

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it.each([401, 403])('forwards expected policy denial %i without a body', async (status) => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))

    const response = await proxyConsoleAccessProbe()

    expect(response.status).toBe(status)
    expect(await response.text()).toBe('')
  })

  it('fails closed when the policy probe is unavailable', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')))

    const response = await proxyConsoleAccessProbe()

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
  })

  it('does not disclose an unexpected upstream response', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unexpected', { status: 500 })))

    const response = await proxyConsoleAccessProbe()

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
  })
})
