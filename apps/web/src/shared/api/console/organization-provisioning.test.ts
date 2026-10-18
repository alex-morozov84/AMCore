// @vitest-environment node
import { createInvitationOperationId } from '@amcore/shared'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/admin-console.generated', () => ({ ADMIN_CONSOLE_CONFIG: { mode: 'host' } }))
vi.mock('./authenticated-proxy', () => ({ isConsoleRequestOriginTrusted: () => true }))
vi.mock('./establishment-deps', () => ({ establishmentConsoleDeps: () => ({}) }))
vi.mock('@/shared/lib/admin-console-config', () => ({
  getConsoleOrigin: () => 'https://console.example.test',
}))
vi.mock('@/shared/api/bff/context-executor', () => ({ executeContextOperation: vi.fn() }))

import { executeContextOperation } from '@/shared/api/bff/context-executor'

import { provisioningOrganization, provisioningRoot } from './organization-provisioning'

const origin = 'https://console.example.test'
const binding = 'a'.repeat(64)
const operationId = createInvitationOperationId()
const body = { operationId, name: 'North shop', firstAdminEmail: 'anna@example.test' }
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/organization-provisionings`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'X-AMCore-Context-Session': binding,
      ...headers,
    },
    body: JSON.stringify(value),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(executeContextOperation).mockResolvedValue({ binding, data: {} })
})

it('preserves the create status and session binding at the fixed upstream route', async () => {
  const response = await provisioningRoot(request())
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const [operation, input] = vi.mocked(executeContextOperation).mock.calls[0]!
  expect(operation).toMatchObject({
    method: 'POST',
    path: '/api/v1/admin/organization-provisionings',
    successStatus: 201,
    timeoutMs: 15000,
  })
  expect(input.expectedSession).toBe(binding)
  expect(operation.body).toMatchObject({ ...body, inviteLocale: 'en' })
})

it.each(['', 'https://foreign.example.test'])(
  'refuses an absent or foreign mutation Origin (%s)',
  async (origin) => {
    expect((await provisioningRoot(request(body, { origin }))).status).toBe(403)
    expect(executeContextOperation).not.toHaveBeenCalled()
  }
)

it.each([
  { ...body, role: 'SUPER_ADMIN' },
  { ...body, operationId: 'not-an-operation' },
])('refuses unknown fields and invalid identity', async (input) => {
  expect((await provisioningRoot(request(input))).status).toBe(400)
  expect(executeContextOperation).not.toHaveBeenCalled()
})

it('rejects oversized bodies before session or upstream work', async () => {
  expect((await provisioningRoot(request({ ...body, name: 'x'.repeat(5000) }))).status).toBe(413)
  expect(executeContextOperation).not.toHaveBeenCalled()
})

it.each(['../other', '%2fother', 'bad/route'])(
  'rejects unsafe organization paths (%s)',
  async (orgId) => {
    expect((await provisioningOrganization(request(), orgId, ['cancel'])).status).toBe(400)
    expect(executeContextOperation).not.toHaveBeenCalled()
  }
)

it('only admits declared actions and forbids query strings on reads', async () => {
  expect((await provisioningOrganization(request(), 'north-shop', ['grant-admin'])).status).toBe(
    400
  )
  const response = await provisioningRoot(
    new Request(`${origin}/api/organization-provisionings/policy?other=1`),
    ['policy']
  )
  expect(response.status).toBe(400)
  expect(executeContextOperation).not.toHaveBeenCalled()
})
