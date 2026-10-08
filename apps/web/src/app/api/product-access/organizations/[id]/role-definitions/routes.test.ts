// @vitest-environment node
import { ROLE_REQUEST_BYTES } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as capabilities from '@/app/api/product-access/organizations/[id]/capabilities/route'
import * as deletion from '@/app/api/product-access/organizations/[id]/role-definitions/[roleId]/deletion/route'
import * as single from '@/app/api/product-access/organizations/[id]/role-definitions/[roleId]/route'
import * as collection from '@/app/api/product-access/organizations/[id]/role-definitions/route'
import {
  createRoleDefinition,
  deleteRoleDefinition,
  listRoleDefinitions,
  readCapabilityCatalogue,
  readRoleDefinition,
  saveRoleDefinition,
} from '@/entities/organization-context/index.server'

vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({
  createRoleDefinition: vi.fn(),
  deleteRoleDefinition: vi.fn(),
  listRoleDefinitions: vi.fn(),
  readCapabilityCatalogue: vi.fn(),
  readRoleDefinition: vi.fn(),
  saveRoleDefinition: vi.fn(),
}))

const origin = 'http://localhost:3002'
const binding = 'a'.repeat(64)
const ok = { binding, data: { ok: true } }
const org = { params: Promise.resolve({ id: 'org-a' }) }
const role = { params: Promise.resolve({ id: 'org-a', roleId: 'role-1' }) }
const url = 'http://0.0.0.0:3000/api/product-access/organizations/org-a'
const json = (body: string, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin, host: 'localhost:3002', ...headers },
  body,
})
beforeEach(() => vi.clearAllMocks())

describe('role-definition BFF routes', () => {
  it('serve reads with private no-store responses and strict single-valued queries', async () => {
    vi.mocked(listRoleDefinitions).mockResolvedValue(ok as never)
    const response = await collection.GET(
      new Request(`${url}/role-definitions?page=2&search=ops`),
      org
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(vi.mocked(listRoleDefinitions).mock.calls[0]![1]).toEqual({ page: '2', search: 'ops' })
    const duplicated = await collection.GET(
      new Request(`${url}/role-definitions?page=1&page=2`),
      org
    )
    expect(duplicated.status).toBe(400)
    vi.mocked(readRoleDefinition).mockResolvedValue(ok as never)
    expect((await single.GET(new Request(`${url}/role-definitions/role-1`), role)).status).toBe(200)
    vi.mocked(readCapabilityCatalogue).mockResolvedValue(ok as never)
    expect((await capabilities.GET(new Request(`${url}/capabilities`), org)).status).toBe(200)
  })

  it('maps create to 201 and passes the strict JSON body through the code-owned operation', async () => {
    vi.mocked(createRoleDefinition).mockResolvedValue(ok as never)
    const response = await collection.POST(
      new Request(`${url}/role-definitions`, json('{"name":"Support"}')),
      org
    )
    expect(response.status).toBe(201)
    expect(vi.mocked(createRoleDefinition).mock.calls[0]![1]).toEqual({ name: 'Support' })
  })

  it('maps save and deletion to 200', async () => {
    vi.mocked(saveRoleDefinition).mockResolvedValue(ok as never)
    vi.mocked(deleteRoleDefinition).mockResolvedValue(ok as never)
    const patch = { ...json('{}'), method: 'PATCH' }
    expect(
      (await single.PATCH(new Request(`${url}/role-definitions/role-1`, patch), role)).status
    ).toBe(200)
    expect(
      (
        await deletion.POST(
          new Request(`${url}/role-definitions/role-1/deletion`, json('{}')),
          role
        )
      ).status
    ).toBe(200)
  })

  it('rejects a foreign Origin, wrong media, a query string and an oversized body before any operation', async () => {
    const calls = [
      collection.POST(
        new Request(`${url}/role-definitions`, json('{}', { origin: 'http://evil.test' })),
        org
      ),
      collection.POST(
        new Request(`${url}/role-definitions`, json('{}', { 'content-type': 'text/plain' })),
        org
      ),
      collection.POST(new Request(`${url}/role-definitions?x=1`, json('{}')), org),
      collection.POST(
        new Request(
          `${url}/role-definitions`,
          json(`{"name":"${'x'.repeat(ROLE_REQUEST_BYTES)}"}`)
        ),
        org
      ),
    ]
    const statuses = (await Promise.all(calls)).map((r) => r.status)
    expect(statuses).toEqual([403, 400, 400, 413])
    expect(createRoleDefinition).not.toHaveBeenCalled()
  })

  it.each([
    ['capabilities', capabilities, 'GET'],
    ['collection', collection, 'GET, POST'],
    ['single', single, 'GET, PATCH'],
    ['deletion', deletion, 'POST'],
  ] as const)(
    'answers every other method on the %s route with 405 and Allow',
    async (_n, mod, allow) => {
      const handlers = mod as unknown as Record<string, () => Response>
      const allowed = new Set(allow.split(', '))
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        if (allowed.has(method)) continue
        const response = handlers[method]!()
        expect(response.status).toBe(405)
        expect(response.headers.get('Allow')).toBe(allow)
      }
    }
  )
})
