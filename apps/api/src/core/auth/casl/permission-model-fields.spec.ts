import { Subject } from '@amcore/shared'

import { DERIVED_FIELDS, MODEL_FIELDS, type ModelSubject } from './permission-model-fields'

import { Prisma } from '@/generated/prisma/client'

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
      const derived = DERIVED_FIELDS[subject as ModelSubject] ?? []
      const stored = Object.keys(MODEL_FIELDS[subject]).filter((field) => !derived.includes(field))
      expect([...stored, ...excluded].sort()).toEqual(Object.values(generated).sort())
    }
  })

  it('declares the derived avatar attribute and keeps the stored key out of the vocabulary', () => {
    expect(DERIVED_FIELDS[Subject.User]).toEqual(['avatarUrl'])
    expect(MODEL_FIELDS[Subject.User]).toHaveProperty('avatarUrl', 'nullableString')
    expect(MODEL_FIELDS[Subject.User]).not.toHaveProperty('avatarKey')
  })
})
