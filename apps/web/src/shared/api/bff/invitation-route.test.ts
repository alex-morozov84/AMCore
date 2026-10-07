import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { invitationRoute } from './invitation-route'
import { InvitationBackendError } from './invitation-upstream'

vi.mock('server-only', () => ({}))
const request = () =>
  new Request('https://app.example.test/api/invitation-flows/example/register', { method: 'POST' })

describe('invitation route response boundary', () => {
  it('preserves code-owned JSON success statuses and privacy headers', async () => {
    for (const status of [200, 201, 202] as const) {
      const response = await invitationRoute(request(), async () => ({ status: 'example' }), status)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ status: 'example' })
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
    }
  })
  it('contains unexpected upstream outcomes and arbitrary exception diagnostics', async () => {
    for (const error of [new InvitationBackendError(502, false), new Error('<test-secret>')]) {
      const response = await invitationRoute(request(), async () => {
        throw error
      })
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('<test-secret>')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    }
  })
  it('returns only the known rejection code/budget and never Zod input diagnostics', async () => {
    let response = await invitationRoute(request(), async () => {
      throw new InvitationBackendError(429, true, 'RATE_LIMIT_EXCEEDED', 20)
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('20')
    expect(await response.json()).toMatchObject({ errorCode: 'RATE_LIMIT_EXCEEDED' })
    response = await invitationRoute(request(), async () =>
      z.literal('valid').parse('<test-secret>')
    )
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('<test-secret>')
  })
})
