import { createTranslator } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { beforeAll, describe, expect, it } from 'vitest'

// Typed as a plain string: a project that keeps only one locale narrows `SUPPORTED_LOCALES` and the
// locale type to that one, and this test must still compile there (it is skipped at run time).
const locale: string = 'ru'

const kept = (SUPPORTED_LOCALES as readonly string[]).includes(locale)

// Russian needs four plural forms; a wrong form reads as a mistake in the product's own words.
// Skipped in a project that does not keep Russian.
describe.skipIf(!kept)('Russian wording of what deleting a role affects', () => {
  let t: (key: string, values: Record<string, number>) => string
  beforeAll(async () => {
    const messages = (await import(`../../../../messages/${locale}.json`)).default
    const translator = createTranslator({
      locale: locale as never,
      messages,
      namespace: 'organizationRoles',
    })
    t = (key, values) => translator(key as never, values as never)
  })

  it.each([
    [1, 'Роль будет отозвана у 1 человека.'],
    [2, 'Роль будет отозвана у 2 человек.'],
    [5, 'Роль будет отозвана у 5 человек.'],
    [11, 'Роль будет отозвана у 11 человек.'],
    [21, 'Роль будет отозвана у 21 человека.'],
    [22, 'Роль будет отозвана у 22 человек.'],
  ])('people: %i', (holders, expected) => {
    expect(t('deletePeople', { holders })).toBe(expected)
  })

  it.each([
    [1, 'Роль будет убрана из 1 ожидающего приглашения.'],
    [2, 'Роль будет убрана из 2 ожидающих приглашений.'],
    [5, 'Роль будет убрана из 5 ожидающих приглашений.'],
    [11, 'Роль будет убрана из 11 ожидающих приглашений.'],
    [21, 'Роль будет убрана из 21 ожидающего приглашения.'],
  ])('invitations: %i', (invitations, expected) => {
    expect(t('deleteInvites', { invitations })).toBe(expected)
  })
})
