import { Subject } from '@amcore/shared'

import { MODEL_FIELDS } from './permission-model-fields'

import { Prisma } from '@/generated/prisma/client'

/**
 * Response attributes that exist in the permission vocabulary but are not stored columns.
 * `avatarUrl` is computed from the stored `avatarKey`; the permission names the attribute the API
 * returns, so installed default permission rows keep their exact field lists.
 */
const DERIVED_ATTRIBUTES: Partial<Record<Subject, string[]>> = {
  [Subject.User]: ['avatarUrl'],
}

describe('permission model field grammar', () => {
  it('reviews every generated scalar when a model changes', () => {
    const cases = [
      [
        Subject.User,
        Prisma.UserScalarFieldEnum,
        ['emailCanonical', 'passwordHash', 'avatarGeneration', 'avatarKey'],
      ],
      [Subject.Organization, Prisma.OrganizationScalarFieldEnum, []],
      [Subject.Role, Prisma.RoleScalarFieldEnum, []],
      [Subject.Permission, Prisma.PermissionScalarFieldEnum, ['conditions', 'fields']],
    ] as const
    for (const [subject, generated, excluded] of cases) {
      const derived = DERIVED_ATTRIBUTES[subject] ?? []
      const stored = Object.keys(MODEL_FIELDS[subject]).filter((field) => !derived.includes(field))
      expect([...stored, ...excluded].sort()).toEqual(Object.values(generated).sort())
    }
  })

  it('keeps the derived avatar attribute in the vocabulary', () => {
    expect(MODEL_FIELDS[Subject.User]).toHaveProperty('avatarUrl', 'nullableString')
    expect(MODEL_FIELDS[Subject.User]).not.toHaveProperty('avatarKey')
  })
})
