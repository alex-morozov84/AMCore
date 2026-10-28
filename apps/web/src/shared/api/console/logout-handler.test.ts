// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./browser-context', () => ({ consoleBrowserContext: vi.fn() }))
vi.mock('@/shared/api/bff/logout-handler', () => ({ handleLogout: vi.fn() }))

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { handleLogout } from '@/shared/api/bff/logout-handler'

import { consoleBrowserContext } from './browser-context'
import { handleConsoleLogout } from './logout-handler'

beforeEach(() => vi.clearAllMocks())
describe('Console logout uses the common original-page intent and primary fence', () => {
  it('forwards the original request and exact Console context without alternative revocation', async () => {
    const context = { audience: 'console', cookieName: '__Host-amcore_console_session' } as never
    vi.mocked(consoleBrowserContext).mockReturnValue(context)
    const rejected = Response.json({ errorCode: 'AUTH_CONTEXT_CHANGED' }, { status: 401 })
    vi.mocked(handleLogout).mockResolvedValue(rejected as never)
    const request = new Request('https://console.example.test/api/console/auth/logout', {
      method: 'POST',
      headers: { 'x-amcore-context-session': 'a'.repeat(64) },
    })
    expect(await handleConsoleLogout(request)).toBe(rejected)
    expect(handleLogout).toHaveBeenCalledWith(request, context)
    expect(rejected.headers.get('set-cookie')).toBeNull()
  })
  it('refuses another surface without a fallback cookie clear', async () => {
    vi.mocked(consoleBrowserContext).mockImplementationOnce(() => {
      throw new ContextRequestError(404, 'NOT_FOUND')
    })
    const response = await handleConsoleLogout(
      new Request('https://shop.example.test/api/console/auth/logout', { method: 'POST' })
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(handleLogout).not.toHaveBeenCalled()
  })
})
