// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/organization-provisioning', () => ({ provisioningRoot: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { provisioningRoot } from '@/shared/api/console/organization-provisioning'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(withConsoleHostGuard).mockImplementation(async (_request, work) => work())
  vi.mocked(provisioningRoot).mockResolvedValue(Response.json({ accepted: true }, { status: 201 }))
})

it.each([GET, POST])('handles the static route without dynamic params', async (handler) => {
  const request = new Request('https://console.example.test/api/organization-provisionings')
  const invoke = handler as (request: Request, context?: unknown) => Promise<Response>
  expect((await invoke(request, { params: undefined })).status).toBe(201)
  expect(provisioningRoot).toHaveBeenCalledWith(request)
})

it('keeps host admission before provisioning', async () => {
  vi.mocked(withConsoleHostGuard).mockResolvedValueOnce(new Response(null, { status: 404 }))
  const invoke = POST as (request: Request, context?: unknown) => Promise<Response>
  expect(
    (
      await invoke(new Request('https://foreign.example.test/api/organization-provisionings'), {
        params: undefined,
      })
    ).status
  ).toBe(404)
  expect(provisioningRoot).not.toHaveBeenCalled()
})
