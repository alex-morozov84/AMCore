import { apiKeyStatus, staleTerminalApiKeyWhere } from './api-key-lifecycle'

describe('API-key terminal lifecycle', () => {
  const now = new Date('2026-09-28T12:00:00Z')
  it('rejects expiry equality and gives explicit revocation precedence', () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: now }, now)).toBe('expired')
    expect(apiKeyStatus({ revokedAt: now, expiresAt: now }, now)).toBe('revoked')
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe('unexpired')
  })
  it('uses either terminal timestamp without extending retention on later revoke', () => {
    const cutoff = new Date('2026-08-29T12:00:00Z')
    expect(staleTerminalApiKeyWhere(now)).toEqual({
      OR: [{ revokedAt: { lte: cutoff } }, { expiresAt: { lte: cutoff } }],
    })
  })
})
