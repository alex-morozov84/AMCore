import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getBackendAccessToken } from '@/shared/api/server/access-token'

import { probeConsoleAccess } from './access-probe'

vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: vi.fn() }))

const mockedAccessToken = vi.mocked(getBackendAccessToken)

describe('probeConsoleAccess', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails closed without a server-held bearer credential', async () => {
    mockedAccessToken.mockResolvedValue(null)

    const status = await probeConsoleAccess()

    expect(status).toBe(401)
  })

  it('forwards only the no-content success status', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const status = await probeConsoleAccess()

    expect(status).toBe(204)
  })

  it.each([401, 403])('forwards expected policy denial %i without a body', async (status) => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))

    const result = await probeConsoleAccess()

    expect(result).toBe(status)
  })

  it('fails closed when the policy probe is unavailable', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')))

    const status = await probeConsoleAccess()

    expect(status).toBe(503)
  })

  it('does not disclose an unexpected upstream response', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unexpected', { status: 500 })))

    const status = await probeConsoleAccess()

    expect(status).toBe(503)
  })

  it('fails closed when server-held bearer acquisition rejects', async () => {
    mockedAccessToken.mockRejectedValue(new Error('vault unavailable'))

    await expect(probeConsoleAccess()).resolves.toBe(503)
  })
})
