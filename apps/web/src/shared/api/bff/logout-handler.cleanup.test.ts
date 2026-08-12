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
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
    vi.mocked(redisVaultStore.delete).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls backend logout with the raw refresh token as a Cookie header, deletes the vault entry, clears the cookie', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/logout')
    expect((init.headers as Record<string, string>).Cookie).toBe('refresh_token=rt-1')
    expect(redisVaultStore.delete).toHaveBeenCalledWith('sess-1')
  })

  it('still clears the cookie and returns 200 when the backend logout call fails', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
    expect(redisVaultStore.delete).toHaveBeenCalledWith('sess-1')
  })

  it('still clears the cookie and returns 200 when the vault delete fails', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    vi.mocked(redisVaultStore.delete).mockRejectedValue(new Error('redis down'))

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
  })

  it('still clears the cookie and returns 200 when reading the current session itself throws (Redis down)', async () => {
    vi.mocked(getCurrentVaultSession).mockRejectedValue(new Error('ECONNREFUSED'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('logs a non-2xx backend logout response instead of silently ignoring it', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(fakeSession())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500'))
    errorSpy.mockRestore()
  })
})
