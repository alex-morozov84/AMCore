import type { Request } from 'express'

import { negotiateLocale } from './locale-negotiation'

/**
 * Build a minimal Request stand-in. `acceptsLanguages` is a jest mock so we can
 * assert the header presence gate runs *before* Express negotiation.
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
    expect(req.acceptsLanguages).toHaveBeenCalled()
  })

  it('returns the negotiated supported locale for a matching header', () => {
    const req = makeReq('en-US,en;q=0.9', 'en')
    expect(negotiateLocale(req)).toBe('en')
  })
})
