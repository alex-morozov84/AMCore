import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'

/**
 * Lives in `apps/api` rather than beside the helper because `packages/shared`
 * has no test runner configured — see the backlog item on that gap. The API is
 * the helper's main consumer (every user-facing link it emails).
 */
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
