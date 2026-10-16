// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ create: vi.fn(), policy: vi.fn(), result: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({
  createOrganization: calls.create,
  readOrganizationCreationPolicy: calls.policy,
  readOrganizationCreationResult: calls.result,
}))

import { organizationCreationHandlers } from './creation-handlers'

const origin = 'http://localhost:3002'
const request = (headers: Record<string, string> = {}, body = '{}', query = '') =>
  new Request(`${origin}/api/product-access/organizations${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })

describe('creation BFF admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.create.mockResolvedValue({ binding: 'a'.repeat(64), data: {} })
  })
  it('requires exact Origin and refuses Referer-only and malformed variants', async () => {
    const rejected: Record<string, string>[] = [
      {},
      { referer: `${origin}/en/organizations` },
      { origin: `${origin}/` },
      { origin: 'http://foreign.test' },
    ]
    for (const headers of rejected) {
      expect((await organizationCreationHandlers.create(request(headers))).status).toBe(403)
    }
    expect(calls.create).not.toHaveBeenCalled()
  })
  it('bounds decoded input and refuses compression, query fields and non-JSON bodies before domain calls', async () => {
    const cases = [
      request({ origin, 'content-encoding': 'gzip' }),
      request({ origin }, '{}', '?creatorId=other'),
      request({ origin, 'content-type': 'text/plain' }),
    ]
    for (const item of cases)
      expect((await organizationCreationHandlers.create(item)).status).toBe(400)
    expect(
      (
        await organizationCreationHandlers.create(
          request({ origin }, JSON.stringify({ name: 'x'.repeat(4096) }))
        )
      ).status
    ).toBe(413)
    expect(calls.create).not.toHaveBeenCalled()
  })
  it('preserves the explicit201 envelope and never caches it', async () => {
    const response = await organizationCreationHandlers.create(
      request({ origin, 'x-amcore-context-session': 'a'.repeat(64) }, '{"name":"Acme"}')
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(calls.create).toHaveBeenCalledWith(
      { name: 'Acme' },
      expect.objectContaining({ expectedSession: 'a'.repeat(64) })
    )
  })
})
