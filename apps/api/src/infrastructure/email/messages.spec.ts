import { emailMessages } from './messages'

/**
 * i18n parity guard (EQS-08).
 *
 * FormatJS renders a missing message id as the literal id string (non-fatal, by
 * design — see the render-robustness integration test). The real risk is a key
 * that exists in one locale but not the other: it would silently ship an
 * untranslated `someKey.id` in the missing locale. This test enforces that both
 * locales expose exactly the same set of message ids.
 */
describe('emailMessages i18n parity', () => {
  const ruKeys = Object.keys(emailMessages.ru).sort()
  const enKeys = Object.keys(emailMessages.en).sort()

  it('ru and en define exactly the same message ids', () => {
    expect(ruKeys).toEqual(enKeys)
  })

  it('has no empty message values in either locale', () => {
    const empties: string[] = []
    for (const [locale, messages] of Object.entries(emailMessages)) {
      for (const [id, value] of Object.entries(messages)) {
        if (typeof value !== 'string' || value.trim() === '') empties.push(`${locale}.${id}`)
      }
    }
    expect(empties).toEqual([])
  })
})
