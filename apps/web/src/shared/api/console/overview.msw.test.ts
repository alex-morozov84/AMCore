// @vitest-environment node
import type { AdminOverviewResponse } from '@amcore/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { fetchConsoleOverview } from './overview'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/server', async () => {
  const { fetchBackend } = await import('../server/backend-fetch')
  return { fetchBackend }
})
vi.mock('../server/access-token', () => ({ getBackendAccessToken: async () => null }))
vi.mock('../bff/trusted-client-ip', () => ({ resolveTrustedClientIp: () => null }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: async () => 'test-console-token' }))

const server = setupServer()
const endpoint = `${process.env.API_URL ?? 'http://localhost:5002'}/api/v1/admin/overview`
const sampledAt = '2026-09-30T12:00:00.000Z'
const unavailable = { status: 'unavailable', sampledAt: null } as const
const observation: AdminOverviewResponse = {
  readiness: 'degraded',
  dependencies: [{ name: 'database', status: 'degraded' }],
  version: 'unknown',
  processRole: 'web',
  checkedAt: sampledAt,
  storageHealthEnabled: false,
  api: { version: null, commit: null, deploymentId: null, environment: null, runtimeMode: 'test' },
  process: { instanceId: '12345678-1234-4234-8234-123456789abc', uptimeSeconds: 10, sampledAt },
  resources: { pool: unavailable, memory: unavailable, filesystem: unavailable },
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('Console Overview HTTP adapter', () => {
  it('preserves degraded readiness and explicit unknown/unavailable facts over HTTP', async () => {
    server.use(
      http.get(endpoint, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer test-console-token')
        return HttpResponse.json(observation)
      })
    )
    expect(await fetchConsoleOverview()).toEqual({ status: 'success', data: observation })
  })

  it('isolates an unavailable filesystem while accepting independent memory values', async () => {
    const memory = {
      status: 'available',
      sampledAt,
      heapUsedBytes: 100,
      rssBytes: 200,
      readinessHeapLimitBytes: 50,
    }
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...observation,
          resources: { ...observation.resources, memory },
        })
      )
    )
    expect(await fetchConsoleOverview()).toMatchObject({
      status: 'success',
      data: { readiness: 'degraded', resources: { memory, filesystem: unavailable } },
    })
  })

  it.each([500, 503])('classifies HTTP %i as observation unavailability', async (status) => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status })))
    expect(await fetchConsoleOverview()).toMatchObject({
      status: 'unavailable',
      reason: 'upstream',
    })
  })

  it('throws for a malformed 2xx instead of reporting ordinary unavailability', async () => {
    server.use(http.get(endpoint, () => HttpResponse.json({ ...observation, process: null })))
    await expect(fetchConsoleOverview()).rejects.toMatchObject({
      kind: 'invalid-payload',
      status: 200,
    })
  })

  it('throws for rejected authorization instead of reporting ordinary unavailability', async () => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 403 })))
    await expect(fetchConsoleOverview()).rejects.toMatchObject({ kind: 'rejected', status: 403 })
  })
})
