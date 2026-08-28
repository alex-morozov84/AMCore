// init:project --mode=single: frontend-url.spec.ts. Found via the real
// `pnpm --filter api test` in init-project.test.mjs — `localizedFrontendUrl`
// is exercised with a hardcoded 'ru' locale throughout its describe block.
// Rewritten to use DEFAULT_LOCALE (already imported, and reflecting
// whichever locale was actually chosen) instead of a second hardcoded
// literal — no locale branching needed in this generator, since the test
// content itself is now locale-generic. One assertion in the sibling
// `localePathPrefix` describe block (added in PR3A specifically to stay
// independently testable — see that function's own doc comment) still
// hardcodes a bare 'ru' as the *typed* first argument, which is a real
// SupportedLocale position, not a plain string array entry — dropped, since
// the first assertion already proves the "more than one locale" branch.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { DEFAULT_LOCALE, localePathPrefix, localizedFrontendUrl } from '@amcore/shared'

/**
 * Lives in \`apps/api\` rather than beside the helper because \`packages/shared\`
 * has no test runner configured — see the backlog item on that gap. The API is
 * the helper's main consumer (every user-facing link it emails).
 */
describe('localizedFrontendUrl', () => {
  it('prefixes the locale, including the default one', () => {
    // \`localePrefix: 'always'\` — the default locale is prefixed too, so a link
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
    // Tokens are URL-safe base64, but a value with \`+\`/\`/\`/\`&\` must not be able
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
  // these pass an explicit \`locales\` array rather than relying on the real
  // constant — otherwise the single-locale branch could never be exercised
  // and this test would pass vacuously forever. See the doc comment on
  // \`localePathPrefix\` for why the parameter exists at all.
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
`

const AFTER = `import { DEFAULT_LOCALE, localePathPrefix, localizedFrontendUrl } from '@amcore/shared'

/**
 * Lives in \`apps/api\` rather than beside the helper because \`packages/shared\`
 * has no test runner configured — see the backlog item on that gap. The API is
 * the helper's main consumer (every user-facing link it emails).
 */
describe('localizedFrontendUrl', () => {
  // Single-locale mode (pnpm init:project --mode=single): SUPPORTED_LOCALES
  // has exactly one entry, so localePathPrefix() omits the prefix entirely —
  // see that function's own doc comment. Every path here is unprefixed.
  it('builds a bare path with no locale prefix', () => {
    expect(localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE, 'verify-email')).toBe(
      'https://app.example.com/verify-email'
    )
  })

  it('returns the bare base URL when no path is given', () => {
    expect(localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE)).toBe(
      'https://app.example.com'
    )
  })

  it('appends query parameters', () => {
    expect(
      localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE, 'reset-password', {
        token: 'abc',
      })
    ).toBe('https://app.example.com/reset-password?token=abc')
  })

  it('percent-encodes query values', () => {
    // Tokens are URL-safe base64, but a value with \`+\`/\`/\`/\`&\` must not be able
    // to inject an extra parameter into a link we put in front of a user.
    expect(
      localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE, 'accept', {
        token: 'a+b/c&d=e',
      })
    ).toBe('https://app.example.com/accept?token=a%2Bb%2Fc%26d%3De')
  })

  it('normalizes slashes on both sides of the join', () => {
    expect(
      localizedFrontendUrl('https://app.example.com/', DEFAULT_LOCALE, '/invite/accept')
    ).toBe('https://app.example.com/invite/accept')
  })

  it('supports a multi-segment path', () => {
    expect(localizedFrontendUrl('https://app.example.com', DEFAULT_LOCALE, 'invite/accept')).toBe(
      'https://app.example.com/invite/accept'
    )
  })
})

describe('localePathPrefix', () => {
  // AMCore upstream's own SUPPORTED_LOCALES never shrinks to one entry, so
  // these pass an explicit \`locales\` array rather than relying on the real
  // constant — otherwise the single-locale branch could never be exercised
  // and this test would pass vacuously forever. See the doc comment on
  // \`localePathPrefix\` for why the parameter exists at all.
  it('prefixes the locale when more than one is supported', () => {
    expect(localePathPrefix('en', ['en', 'ru'])).toBe('/en')
  })

  it('omits the prefix once exactly one locale is supported (pnpm init:project --mode=single)', () => {
    expect(localePathPrefix('en', ['en'])).toBe('')
  })

  it('defaults to the real SUPPORTED_LOCALES, which is single-locale after init:project --mode=single', () => {
    expect(localePathPrefix(DEFAULT_LOCALE)).toBe('')
  })
})
`

export function buildApiFrontendUrlTestSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/api/src/core/auth/frontend-url.spec.ts'),
      { expectedBefore: BEFORE, after: AFTER },
      'frontend-url.spec.ts: use DEFAULT_LOCALE generically instead of a hardcoded second locale'
    ),
  ]
}
