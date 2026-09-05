import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE } from '../constants'

import { localePathPrefix, localizedFrontendUrl } from './frontend-url'

describe('localizedFrontendUrl', () => {
  it('prefixes the locale, including the default one', () => {
    // `localePrefix: 'always'` — the default locale is prefixed too, so a link
    // to the bare path would be resolved by cookie/Accept-Language instead.
    expect(localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE, 'verify-email')).toBe(
      'https://app.example.com/en/verify-email'
    )
    expect(localizedFrontendUrl('https://app.example.com', 'ru', 'verify-email')).toBe(
      'https://app.example.com/ru/verify-email'
    )
  })

  it('returns the locale root when no path is given', () => {
    expect(localizedFrontendUrl('https://app.example.com', 'ru')).toBe('https://app.example.com/ru')
  })

  it('appends query parameters', () => {
    expect(
      localizedFrontendUrl('https://app.example.com', 'ru', 'reset-password', { token: 'abc' })
    ).toBe('https://app.example.com/ru/reset-password?token=abc')
  })

  it('percent-encodes query values', () => {
    // Tokens are URL-safe base64, but a value with `+`/`/`/`&` must not be able
    // to inject an extra parameter into a link we put in front of a user.
    expect(
      localizedFrontendUrl('https://app.example.com', 'en', 'accept', { token: 'a+b/c&d=e' })
    ).toBe('https://app.example.com/en/accept?token=a%2Bb%2Fc%26d%3De')
  })

  it('normalizes slashes on both sides of the join', () => {
    expect(localizedFrontendUrl('https://app.example.com/', 'ru', '/invite/accept')).toBe(
      'https://app.example.com/ru/invite/accept'
    )
  })

  it('supports a multi-segment path', () => {
    expect(localizedFrontendUrl('https://app.example.com', 'ru', 'invite/accept')).toBe(
      'https://app.example.com/ru/invite/accept'
    )
  })
})

describe('localePathPrefix', () => {
  // AMCore upstream's own SUPPORTED_LOCALES never shrinks to one entry, so
  // these pass an explicit `locales` array rather than relying on the real
  // constant — otherwise the single-locale branch could never be exercised
  // and this test would pass vacuously forever. See the doc comment on
  // `localePathPrefix` for why the parameter exists at all.
  it('prefixes the locale when more than one is supported', () => {
    expect(localePathPrefix('en', ['en', 'ru'])).toBe('/en')
    expect(localePathPrefix('ru', ['en', 'ru'])).toBe('/ru')
  })

  it('omits the prefix once exactly one locale is supported (pnpm init:project --mode=single)', () => {
    expect(localePathPrefix('en', ['en'])).toBe('')
  })

  it('defaults to the real SUPPORTED_LOCALES, which is multi-locale on AMCore upstream today', () => {
    expect(localePathPrefix('en')).toBe('/en')
  })
})
