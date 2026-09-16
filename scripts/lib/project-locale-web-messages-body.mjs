const CATEGORIES = {
  en: "['one', 'other']",
  ru: "['one', 'few', 'many', 'other']",
}

export const WEB_MESSAGES_DOC = `/**
 * CLDR plural categories the one supported locale must supply whenever a
 * message uses an ICU \`plural\` argument.
 *
 * NOTE: this check is currently **idle** — no web message uses an ICU plural
 * yet, so it passes vacuously. It is kept armed deliberately rather than
 * backed by an invented pluralized string: it bites the moment the first real
 * one lands.
 */`

export function webMessagesSuite(locale) {
  return `describe('message catalogue', () => {
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
})`
}

export const webPluralCategories = (locale) => CATEGORIES[locale]
