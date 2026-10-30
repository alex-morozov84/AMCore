// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentVaultSession } from './current-session'
import { handleLogout } from './logout-handler'
import { fakeSession, makeRequest } from './logout-handler.test-helpers'
import { isTrustedOrigin } from './origin-guard'
import { redisVaultStore } from './session-vault-store'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./current-session', () => ({ getCurrentVaultSession: vi.fn() }))
vi.mock('./session-vault-store', () => ({ redisVaultStore: { delete: vi.fn() } }))

describe('handleLogout — backend/vault cleanup and partial-failure handling', () => {
  it('refuses an old page intent against a newly selected cookie without clearing or revoking the new session', async () => {
    const current = fakeSession('b'.repeat(43))
    vi.mocked(getCurrentVaultSession).mockResolvedValue(current)
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    const response = await handleLogout(makeRequest(current, 'f'.repeat(64)))
    expect(response.status).toBe(401)
    expect((await response.json()).errorCode).toBe('AUTH_CONTEXT_CHANGED')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-logout-browser-key-at-least-32>')
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
    vi.mocked(redisVaultStore.delete).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('calls backend logout with the raw refresh token as a Cookie header, deletes the exact vault entry without rewriting cookies', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/logout')
    expect(new Headers(init.headers).get('cookie')).toBe('refresh_token=rt-1')
    expect(redisVaultStore.delete).toHaveBeenCalledWith('s'.repeat(43))
  })

  it('returns unconfirmed 503 without clearing or deleting the selected vault when backend logout fails', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
  })

  it('returns 200 after confirmed server retirement without rewriting cookies when vault cleanup fails', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    vi.mocked(redisVaultStore.delete).mockRejectedValue(new Error('redis down'))

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns 503 without cookie clearing when the current vault cannot be read', async () => {
    vi.mocked(getCurrentVaultSession).mockRejectedValue(new Error('ECONNREFUSED'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns 503 for a failed primary logout without claiming success', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
