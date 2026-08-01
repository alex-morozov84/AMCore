import { SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'

import { routing } from './routing'

type Catalogue = Record<string, unknown>

const catalogues: Record<string, Catalogue> = { en, ru }

/** Flatten to dotted leaf paths, e.g. `auth.login`. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  )
}

function leafEntries(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]]
  }
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    leafEntries(child, prefix ? `${prefix}.${key}` : key)
  )
}

/**
 * CLDR plural categories that each locale must supply whenever a message uses
 * an ICU `plural` argument. Russian needs `few`/`many`; supplying only
 * `one`/`other` silently renders wrong grammar for counts like 2 or 5 — and it
 * stays invisible while testing in English, which is exactly why this is a test
 * and not a review checklist item.
 */
const REQUIRED_PLURAL_CATEGORIES: Record<string, string[]> = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
}

describe('message catalogues', () => {
  it('has a catalogue for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(catalogues)).toContain(locale)
    }
    // Guards the reverse direction too: an orphaned catalogue for a locale the
    // backend does not support would render but never be reachable.
    expect(Object.keys(catalogues).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('routing is derived from the shared locale contract', () => {
    expect([...routing.locales].sort()).toEqual([...SUPPORTED_LOCALES].sort())
    expect(SUPPORTED_LOCALES).toContain(routing.defaultLocale)
  })

  const basePaths = leafPaths(en).sort()

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    '%s has exactly the same keys as the en source catalogue',
    (locale) => {
      const paths = leafPaths(catalogues[locale]).sort()

      // Reported as two explicit sets rather than a bare deep-equal, so a
      // failure names the offending keys instead of dumping both catalogues.
      const missing = basePaths.filter((path) => !paths.includes(path))
      const extra = paths.filter((path) => !basePaths.includes(path))

      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    }
  )

  it.each(SUPPORTED_LOCALES)('%s has no empty message values', (locale) => {
    const empty = leafEntries(catalogues[locale])
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([path]) => path)

    expect(empty).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s supplies every required plural category', (locale) => {
    const required = REQUIRED_PLURAL_CATEGORIES[locale]
    expect(required, `no plural categories declared for ${locale}`).toBeDefined()

    const offenders = leafEntries(catalogues[locale])
      .filter(([, value]) => typeof value === 'string' && /\{[^}]*,\s*plural\s*,/.test(value))
      .filter(([, value]) => !required!.every((category) => (value as string).includes(category)))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
