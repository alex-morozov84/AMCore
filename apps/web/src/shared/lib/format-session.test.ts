import { describe, expect, it } from 'vitest'

import { formatSessionLocation, parseSessionDevice } from './format-session'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const MOBILE_SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('parseSessionDevice', () => {
  it('parses browser and OS from a desktop Chrome user agent', () => {
    expect(parseSessionDevice(CHROME_MAC)).toEqual({
      browser: 'Chrome',
      os: 'macOS',
      platformType: 'desktop',
    })
  })

  it('parses browser and OS from a mobile Safari user agent', () => {
    expect(parseSessionDevice(MOBILE_SAFARI_IOS)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      platformType: 'mobile',
    })
  })

  it('returns null/null for a missing user agent', () => {
    expect(parseSessionDevice(null)).toEqual({ browser: null, os: null, platformType: null })
  })

  it('returns null/null for an unparseable user agent, never throwing', () => {
    expect(parseSessionDevice('not a real user agent string')).toEqual({
      browser: null,
      os: null,
      platformType: null,
    })
  })
})

describe('formatSessionLocation', () => {
  it('returns null when there is no location', () => {
    expect(formatSessionLocation(null, 'en')).toBeNull()
  })

  it('composes "city, country" when both are present', () => {
    expect(formatSessionLocation({ city: 'Berlin', countryCode: 'DE' }, 'en')).toBe(
      'Berlin, Germany'
    )
  })

  it('localizes the country name to the active locale', () => {
    expect(formatSessionLocation({ city: 'Berlin', countryCode: 'DE' }, 'ru')).toBe(
      'Berlin, Германия'
    )
  })

  it('falls back to country name alone when city is absent', () => {
    expect(formatSessionLocation({ city: null, countryCode: 'DE' }, 'en')).toBe('Germany')
  })

  it('falls back to city alone when country is unresolvable', () => {
    expect(formatSessionLocation({ city: 'Somewhere', countryCode: null }, 'en')).toBe('Somewhere')
  })

  it('returns null when both city and country are absent', () => {
    expect(formatSessionLocation({ city: null, countryCode: null }, 'en')).toBeNull()
  })
})
