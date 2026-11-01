import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
    const file = JSON.parse(
      readFileSync(new URL('../config/locales.json', import.meta.url), 'utf8')
    )
    expect([...shipped.SUPPORTED_LOCALES]).toEqual(file.enabled)
    expect(shipped.DEFAULT_LOCALE).toBe(file.default)
  })

  it('serves one locale and makes it the default', async () => {
    const { SUPPORTED_LOCALES, DEFAULT_LOCALE } = await withSettings(settings(['ru'], 'ru'))
    expect([...SUPPORTED_LOCALES]).toEqual(['ru'])
    expect(DEFAULT_LOCALE).toBe('ru')
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

  it('reads a not-served catalogue locale as the default and keeps rejecting anomalies', async () => {
    const { parseSupportedLocale, coerceSupportedLocale } = await withSettings(
      settings(['ru'], 'ru')
    )
    expect(parseSupportedLocale('ru')).toBe('ru')
    expect(parseSupportedLocale('en')).toBe('ru')
    expect(() => parseSupportedLocale('de')).toThrow()
    expect(coerceSupportedLocale('en')).toBe('ru')
    expect(coerceSupportedLocale('de')).toBe('ru')
    expect(coerceSupportedLocale(null)).toBe('ru')
  })

  it('accepts a new choice only when this build serves it', async () => {
    const { supportedLocaleSchema } = await withSettings(settings(['ru'], 'ru'))
    expect(supportedLocaleSchema.safeParse('ru').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('en').success).toBe(false)
  })

  it('keeps the shared link prefix rule: no prefix with one locale', async () => {
    vi.resetModules()
    vi.doMock('../config/locales.json', () => ({ default: settings(['ru'], 'ru') }))
    const { localizedFrontendUrl } = await import('../lib/frontend-url')
    expect(localizedFrontendUrl('https://app.example.com', 'ru', '/invite/accept')).toBe(
      'https://app.example.com/invite/accept'
    )
  })
})
