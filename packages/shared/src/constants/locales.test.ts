import { afterEach, describe, expect, it, vi } from 'vitest'

import shippedFile from '../config/locales.json'

type Settings = { version: number; enabled: string[]; default: string }

/** Loads the shared modules with a given `locales.json`, as a build with that file would. */
async function withSettings(settings: unknown) {
  vi.resetModules()
  vi.doMock('../config/locales.json', () => ({ default: settings }))
  const constants = await import('./locales')
  const auth = await import('../schemas/auth')
  return { ...constants, ...auth }
}

afterEach(() => {
  vi.doUnmock('../config/locales.json')
  vi.resetModules()
})

const settings = (enabled: string[], fallback: string): Settings => ({
  version: 1,
  enabled,
  default: fallback,
})

describe('locale settings file', () => {
  it('serves exactly what the settings file lists', async () => {
    const shipped = await import('./locales')
    const file = shippedFile
    expect([...shipped.SERVED_LOCALES]).toEqual(file.enabled)
    expect(shipped.DEFAULT_LOCALE).toBe(file.default)
  })

  it.each(['en', 'ru'])('serves only %s and makes it the default', async (locale) => {
    const { SERVED_LOCALES, DEFAULT_LOCALE, LOCALE_CATALOGUES } = await withSettings(
      settings([locale], locale)
    )
    expect([...SERVED_LOCALES]).toEqual([locale])
    expect(DEFAULT_LOCALE).toBe(locale)
    expect([...LOCALE_CATALOGUES]).toEqual(['en', 'ru'])
  })

  it.each([
    ['an empty list', settings([], 'en'), /enabled/],
    ['a duplicate entry', settings(['en', 'en'], 'en'), /LOCALE_DUPLICATE/],
    ['a default that is not served', settings(['ru'], 'en'), /LOCALE_DEFAULT_NOT_ENABLED/],
    ['an unknown locale', settings(['de'], 'de'), /enabled/],
    ['another version', { ...settings(['en'], 'en'), version: 2 }, /version/],
    ['an extra key', { ...settings(['en'], 'en'), extra: true }, /\(/],
  ])('fails the build for %s', async (_name, invalid, message) => {
    await expect(withSettings(invalid)).rejects.toThrow(message)
  })
})

describe('stored locale handling when this build serves one locale', () => {
  it('classifies every case separately', async () => {
    const { classifyStoredLocale } = await withSettings(settings(['ru'], 'ru'))
    expect(classifyStoredLocale('ru')).toBe('enabled')
    expect(classifyStoredLocale('en')).toBe('disabled')
    expect(classifyStoredLocale(null)).toBe('absent')
    expect(classifyStoredLocale(undefined)).toBe('absent')
    expect(classifyStoredLocale('')).toBe('absent')
    expect(classifyStoredLocale('de')).toBe('unknown')
  })

  it.each(['en', 'ru'])('reads stored values with %s as the only served locale', async (locale) => {
    const { parseSupportedLocale, coerceSupportedLocale } = await withSettings(
      settings([locale], locale)
    )
    expect(parseSupportedLocale('ru')).toBe(locale)
    expect(parseSupportedLocale('en')).toBe(locale)
    expect(() => parseSupportedLocale('de')).toThrow()
    expect(coerceSupportedLocale('en')).toBe(locale)
    expect(coerceSupportedLocale('ru')).toBe(locale)
    expect(coerceSupportedLocale('de')).toBe(locale)
    expect(coerceSupportedLocale(null)).toBe(locale)
  })

  it.each([['en', 'ru'], ['en'], ['ru']])(
    'accepts choices only from the served set %j',
    async (...enabled) => {
      const { supportedLocaleSchema } = await withSettings(settings(enabled, enabled[0]!))
      for (const locale of ['en', 'ru']) {
        expect(supportedLocaleSchema.safeParse(locale).success).toBe(enabled.includes(locale))
      }
    }
  )

  it('keeps the shared link prefix rule: no prefix with one locale', async () => {
    vi.resetModules()
    vi.doMock('../config/locales.json', () => ({ default: settings(['ru'], 'ru') }))
    const { localizedFrontendUrl } = await import('../lib/frontend-url')
    expect(localizedFrontendUrl('https://app.example.com', 'ru', '/invite/accept')).toBe(
      'https://app.example.com/invite/accept'
    )
  })
})
