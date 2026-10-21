import { assertTokenFrontend, frontendTokenData } from './frontend-token.js'

const admin = { frontend: 'admin' as const, placementFingerprint: 'a'.repeat(64) }
const site = { frontend: 'site' as const, placementFingerprint: 'a'.repeat(64) }

describe('frontend-bound email/invitation credentials', () => {
  it('writes the proved destination and fingerprint, while native issuance keeps legacy defaults', () => {
    expect(frontendTokenData(admin)).toEqual({
      frontendDestination: 'admin',
      placementFingerprint: admin.placementFingerprint,
    })
    expect(frontendTokenData()).toEqual({})
  })

  it('accepts matching browser destinations and legacy site links', () => {
    expect(() => assertTokenFrontend(frontendTokenData(admin), admin)).not.toThrow()
    expect(() =>
      assertTokenFrontend({ frontendDestination: 'site', placementFingerprint: null }, site)
    ).not.toThrow()
  })

  it('rejects wrong browser surface or changed placement before consumption', () => {
    expect(() => assertTokenFrontend(frontendTokenData(admin), site)).toThrow()
    expect(() => assertTokenFrontend(frontendTokenData(site), admin)).toThrow()
    expect(() =>
      assertTokenFrontend(frontendTokenData(admin), {
        ...admin,
        placementFingerprint: 'b'.repeat(64),
      })
    ).toThrow()
  })

  it('preserves explicit native consumption without granting it a web frontend context', () => {
    expect(() => assertTokenFrontend(frontendTokenData(admin))).not.toThrow()
  })
})
