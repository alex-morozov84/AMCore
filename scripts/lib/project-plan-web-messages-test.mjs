// init:project --mode=single: messages.test.ts, kept in sync with
// project-plan-web-messages.mjs's catalogue deletion and
// project-plan-web-structure.mjs's deletion of routing.ts. Whole-file
// exactContentStep, not targeted patches: once there is only one catalogue,
// the cross-locale parity tests this file exists for have nothing left to
// compare, so most of the file changes.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const REQUIRED_PLURAL_CATEGORIES = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
}

const BEFORE = `import { SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'

import { routing } from './routing'

type Catalogue = Record<string, unknown>

const catalogues: Record<string, Catalogue> = { en, ru }

/** Flatten to dotted leaf paths, e.g. \`auth.login\`. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    leafPaths(child, prefix ? \`\${prefix}.\${key}\` : key)
  )
}

function leafEntries(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]]
  }
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    leafEntries(child, prefix ? \`\${prefix}.\${key}\` : key)
  )
}

/**
 * CLDR plural categories that each locale must supply whenever a message uses
 * an ICU \`plural\` argument. Russian needs \`few\`/\`many\`; supplying only
 * \`one\`/\`other\` silently renders wrong grammar for counts like 2 or 5 — and it
 * stays invisible while testing in English, which is exactly why this is a test
 * and not a review checklist item.
 *
 * NOTE: this check is currently **idle** — no web message uses an ICU plural
 * yet, so it passes vacuously. It is kept armed deliberately rather than
 * backed by an invented pluralized string: it bites the moment the first real
 * one lands. The backend email catalogue does have real plurals and its
 * equivalent guard asserts non-vacuity.
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
    expect(required, \`no plural categories declared for \${locale}\`).toBeDefined()

    const offenders = leafEntries(catalogues[locale])
      .filter(([, value]) => typeof value === 'string' && /\\{[^}]*,\\s*plural\\s*,/.test(value))
      .filter(([, value]) => !required!.every((category) => (value as string).includes(category)))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
`

function after(locale) {
  const categoriesLiteral = REQUIRED_PLURAL_CATEGORIES[locale].map((c) => `'${c}'`).join(', ')

  return `import { SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import catalogue from '../../messages/${locale}.json'

type Catalogue = Record<string, unknown>

function leafEntries(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]]
  }
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    leafEntries(child, prefix ? \`\${prefix}.\${key}\` : key)
  )
}

/**
 * CLDR plural categories the one supported locale must supply whenever a
 * message uses an ICU \`plural\` argument.
 *
 * NOTE: this check is currently **idle** — no web message uses an ICU plural
 * yet, so it passes vacuously. It is kept armed deliberately rather than
 * backed by an invented pluralized string: it bites the moment the first real
 * one lands.
 */
const REQUIRED_PLURAL_CATEGORIES = [${categoriesLiteral}]

describe('message catalogue', () => {
  it('has exactly the one supported locale', () => {
    expect(SUPPORTED_LOCALES).toEqual(['${locale}'])
  })

  it('has no empty message values', () => {
    const empty = leafEntries(catalogue)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([path]) => path)

    expect(empty).toEqual([])
  })

  it('supplies every required plural category', () => {
    const offenders = leafEntries(catalogue)
      .filter(([, value]) => typeof value === 'string' && /\\{[^}]*,\\s*plural\\s*,/.test(value))
      .filter(
        ([, value]) =>
          !REQUIRED_PLURAL_CATEGORIES.every((category) => (value as string).includes(category))
      )
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
`
}

export function buildWebMessagesTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/i18n/messages.test.ts'),
      { expectedBefore: BEFORE, after: after(locale) },
      'messages.test.ts: test the one remaining catalogue directly, drop the routing-parity checks'
    ),
  ]
}
