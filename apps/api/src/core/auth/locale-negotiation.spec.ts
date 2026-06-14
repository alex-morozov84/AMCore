import type { Request } from 'express'

import { supportedLocaleSchema, timezoneSchema } from '@amcore/shared'

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

describe('supportedLocaleSchema', () => {
  it('accepts supported locales and rejects others', () => {
    expect(supportedLocaleSchema.safeParse('ru').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('en').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('de').success).toBe(false)
    expect(supportedLocaleSchema.safeParse('EN').success).toBe(false)
  })
})

describe('timezoneSchema', () => {
  it.each(['UTC', 'Europe/Moscow', 'America/New_York', 'US/Eastern'])(
    'accepts the named IANA zone %s',
    (tz) => {
      expect(timezoneSchema.safeParse(tz).success).toBe(true)
    }
  )

  it.each(['+01:00', '-0500', '+23', '-2359'])('rejects the numeric offset %s', (tz) => {
    expect(timezoneSchema.safeParse(tz).success).toBe(false)
  })

  it('rejects an unknown zone name', () => {
    expect(timezoneSchema.safeParse('Mars/Phobos').success).toBe(false)
  })
})
