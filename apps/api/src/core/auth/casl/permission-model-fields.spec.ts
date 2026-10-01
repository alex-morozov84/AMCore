import { Subject } from '@amcore/shared'

import { MODEL_FIELDS } from './permission-model-fields'

import { Prisma } from '@/generated/prisma/client'

describe('permission model field grammar', () => {
  it('reviews every generated scalar when a model changes', () => {
    const cases = [
      [
        Subject.User,
        Prisma.UserScalarFieldEnum,
        ['emailCanonical', 'passwordHash', 'avatarGeneration'],
      ],
      [Subject.Organization, Prisma.OrganizationScalarFieldEnum, []],
      [Subject.Role, Prisma.RoleScalarFieldEnum, []],
      [Subject.Permission, Prisma.PermissionScalarFieldEnum, ['conditions', 'fields']],
    ] as const
    for (const [subject, generated, excluded] of cases) {
      expect([...Object.keys(MODEL_FIELDS[subject]), ...excluded].sort()).toEqual(
        Object.values(generated).sort()
      )
    }
  })
})
