import type { Request } from 'express'

import { SUPPORTED_LOCALES } from '@amcore/shared'

import { negotiateLocale } from './locale-negotiation'

/**
 * Build a minimal Request stand-in. `acceptsLanguages` is a jest mock so we can
 * assert negotiation no longer depends on Express request methods.
 */
function makeReq(header: string | undefined, match: string | false): Request {
  return {
    headers: header === undefined ? {} : { 'accept-language': header },
    acceptsLanguages: jest.fn(() => match),
  } as unknown as Request
}

describe('negotiateLocale', () => {
  it('returns undefined and skips negotiation when the header is absent', () => {
    const req = makeReq(undefined, 'ru')
    expect(negotiateLocale(req)).toBeUndefined()
    expect(req.acceptsLanguages).not.toHaveBeenCalled()
  })

  it('returns undefined for a blank header without negotiating', () => {
    const req = makeReq('   ', 'ru')
    expect(negotiateLocale(req)).toBeUndefined()
    expect(req.acceptsLanguages).not.toHaveBeenCalled()
  })

  it('returns undefined for a present header that matches no supported locale', () => {
    const req = makeReq('de-DE,de;q=0.9', false)
    expect(negotiateLocale(req)).toBeUndefined()
    expect(req.acceptsLanguages).not.toHaveBeenCalled()
  })

  it('returns the negotiated supported locale for a matching header', () => {
    const req = makeReq('en-US,en;q=0.9', 'en')
    expect(negotiateLocale(req)).toBe('en')
  })

  it.each([
    ['ru-RU,ru;q=0.9,en;q=0.5', 'ru'],
    ['ru;q=0.1,en;q=0.9', 'en'],
    ['en;q=0,ru;q=0', undefined],
    ['de;q=1,*;q=0.1', 'en'],
  ])('uses the actual parser for %s without an Express request', (header, expected) => {
    const req = { headers: { 'accept-language': header } } as Request
    // These headers offer both locales (or a wildcard); a single-locale fork selects its only locale.
    const locales: readonly string[] = SUPPORTED_LOCALES
    const supported = expected && locales.length === 1 ? locales[0] : expected
    expect(negotiateLocale(req)).toBe(supported)
  })
})
