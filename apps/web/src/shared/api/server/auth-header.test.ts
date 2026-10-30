import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionVaultUnavailableError } from '../bff/errors'

import { getBackendSessionCredential } from './access-token'
import { resolveAuthHeader } from './auth-header'
import { BackendAuthRequiredError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('./access-token', () => ({ getBackendSessionCredential: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveAuthHeader', () => {
  it("'none' never calls getBackendSessionCredential and returns no header", async () => {
    const result = await resolveAuthHeader('none')

    expect(result).toEqual({})
    expect(getBackendSessionCredential).not.toHaveBeenCalled()
  })

  it("'optional' attaches a Bearer header when a session exists", async () => {
    vi.mocked(getBackendSessionCredential).mockResolvedValue({
      accessToken: 'at-1',
      browserHeaders: {},
    })

    expect(await resolveAuthHeader('optional')).toEqual({
      header: 'Bearer at-1',
      browserHeaders: {},
    })
  })

  it("'optional' proceeds anonymously (no header, no throw) when genuinely logged out", async () => {
    vi.mocked(getBackendSessionCredential).mockResolvedValue(null)

    expect(await resolveAuthHeader('optional')).toEqual({})
  })

  it("'optional' reports unavailable (never silently anonymous) when the vault throws", async () => {
    vi.mocked(getBackendSessionCredential).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('Redis unreachable'))
    )

    expect(await resolveAuthHeader('optional')).toEqual({ unavailable: true })
  })

  it("'optional' rethrows an unknown token-resolution bug", async () => {
    vi.mocked(getBackendSessionCredential).mockRejectedValue(new Error('programming defect'))

    await expect(resolveAuthHeader('optional')).rejects.toThrow('programming defect')
  })

  it("'required' attaches a Bearer header when a session exists", async () => {
    vi.mocked(getBackendSessionCredential).mockResolvedValue({
      accessToken: 'at-1',
      browserHeaders: {},
    })

    expect(await resolveAuthHeader('required')).toEqual({
      header: 'Bearer at-1',
      browserHeaders: {},
    })
  })

  it("'required' throws BackendAuthRequiredError when genuinely logged out", async () => {
    vi.mocked(getBackendSessionCredential).mockResolvedValue(null)

    await expect(resolveAuthHeader('required')).rejects.toBeInstanceOf(BackendAuthRequiredError)
  })

  it("'required' reports unavailable (not BackendAuthRequiredError) when the vault throws", async () => {
    vi.mocked(getBackendSessionCredential).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('Redis unreachable'))
    )

    expect(await resolveAuthHeader('required')).toEqual({ unavailable: true })
  })

  it("'required' rethrows an unknown token-resolution bug", async () => {
    vi.mocked(getBackendSessionCredential).mockRejectedValue(new Error('programming defect'))

    await expect(resolveAuthHeader('required')).rejects.toThrow('programming defect')
  })

  it('a custom tokenResolver is used instead of the product session, and never falls back to it', async () => {
    const customResolver = vi.fn().mockResolvedValue('console-token')

    const result = await resolveAuthHeader('required', customResolver)

    expect(result).toEqual({ header: 'Bearer console-token' })
    expect(customResolver).toHaveBeenCalledOnce()
    expect(getBackendSessionCredential).not.toHaveBeenCalled()
  })

  it("'required' with a custom tokenResolver still throws when it resolves null - no product-session fallback", async () => {
    const customResolver = vi.fn().mockResolvedValue(null)

    await expect(resolveAuthHeader('required', customResolver)).rejects.toBeInstanceOf(
      BackendAuthRequiredError
    )
    expect(getBackendSessionCredential).not.toHaveBeenCalled()
  })
})
