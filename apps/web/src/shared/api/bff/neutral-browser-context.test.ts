// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { fetchBackendResponse } from '@/shared/api/backend-transport'

import type { ContextExecutorDeps } from './context-executor'
import { invitationIncomingSession } from './invitation-request-snapshot'
import { requireNeutralBrowserContext } from './neutral-browser-context'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/backend-transport', () => ({
  fetchBackendResponse: vi.fn(),
  getBackendBaseUrl: () => 'http://api.test',
}))
beforeEach(() => vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8)))
afterEach(() => vi.unstubAllEnvs())
const source = () => new Headers({ cookie: `amcore_browser_context=${'a'.repeat(43)}` })
const view = (state: string) => ({
  contextId: 'context-x',
  generation: 2,
  state,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
})

it.each(['empty', 'logged_out'])(
  'admits only anonymous invitation state for primary %s',
  async (state) => {
    vi.mocked(fetchBackendResponse).mockResolvedValue(Response.json(view(state)))
    const verifyBinding = vi.fn()
    const deps = {
      readSessionId: async () => 's'.repeat(43),
      store: { get: async () => null },
      webContext: { audience: 'product' },
      verifyBinding,
    } as unknown as ContextExecutorDeps
    await expect(invitationIncomingSession(deps, source())).resolves.toBeNull()
    expect(verifyBinding).not.toHaveBeenCalled()
    const [, , options] = vi.mocked(fetchBackendResponse).mock.calls.at(-1)!
    expect(options?.body).toBe(JSON.stringify({ binding: 'a'.repeat(43) }))
    expect(options?.headers).not.toHaveProperty('cookie')
    expect(options?.headers).not.toHaveProperty('authorization')
  }
)
it.each(['reserved', 'published'])('does not adopt a competing %s revision', async (state) => {
  vi.mocked(fetchBackendResponse).mockResolvedValue(Response.json(view(state)))
  await expect(requireNeutralBrowserContext(source(), 'product')).rejects.toMatchObject({
    status: 401,
  })
})
it('fails closed on absent anchor, malformed primary result and primary outage', async () => {
  await expect(requireNeutralBrowserContext(new Headers(), 'product')).rejects.toMatchObject({
    status: 401,
  })
  vi.mocked(fetchBackendResponse).mockResolvedValue(Response.json({ state: 'empty' }))
  await expect(requireNeutralBrowserContext(source(), 'product')).rejects.toMatchObject({
    status: 503,
  })
  vi.mocked(fetchBackendResponse).mockResolvedValue(new Response(null, { status: 503 }))
  await expect(requireNeutralBrowserContext(source(), 'product')).rejects.toMatchObject({
    status: 503,
  })
})
