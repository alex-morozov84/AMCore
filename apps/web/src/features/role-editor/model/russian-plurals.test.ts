import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import ru from '../../../../messages/ru.json'

const t = createTranslator({ locale: 'ru', messages: ru, namespace: 'organizationRoles' })

// Russian needs four plural forms; a wrong form reads as a mistake in the product's own words.
describe('Russian wording of what deleting a role affects', () => {
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
