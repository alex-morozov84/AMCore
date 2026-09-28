import { subject } from '@casl/ability'

import {
  Action,
  orgResponseSchema,
  Subject,
  SystemRole,
  updateProfileSchema,
  userResponseSchema,
} from '@amcore/shared'

import { AbilityFactory } from './ability.factory'
import {
  ORG_DEFAULT_PERMISSIONS,
  ORG_DEFAULT_ROLE_GRANTS,
  ORG_READ_FIELDS,
  OWN_USER_READ_FIELDS,
  OWN_USER_UPDATE_FIELDS,
} from './org-role-defaults'

import { Prisma } from '@/generated/prisma/client'

it('defaults are closed on resources and fields for every ordinary template', async () => {
  expect(ORG_DEFAULT_PERMISSIONS).toHaveLength(6)
  expect(Object.values(ORG_DEFAULT_ROLE_GRANTS).flat()).toHaveLength(11)
  for (const [name, indexes] of Object.entries(ORG_DEFAULT_ROLE_GRANTS)) {
    const factory = new AbilityFactory(
      {
        getPermissions: async () => indexes.map((index) => ORG_DEFAULT_PERMISSIONS[index]!),
      } as never,
      { getCurrent: async () => 1 } as never
    )
    const context = await factory.createAuthorizationContext({
      type: 'jwt',
      sub: 'self',
      systemRole: SystemRole.User,
      organizationId: 'org',
      aclVersion: 1,
    })
    const ability = context.ability
    expect(ability.can(Action.Read, 'FutureDomain' as never)).toBe(false)
    expect(ability.can(Action.Read, Subject.Role)).toBe(false)
    expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
    const org = subject('Organization', { id: 'org' } as never)
    expect(ability.can(Action.Read, org, 'name')).toBe(true)
    expect(ability.can(Action.Read, org, 'futureSecret')).toBe(false)
    expect(
      ability.can(Action.Read, subject('Organization', { id: 'foreign' } as never), 'name')
    ).toBe(false)
    const own = subject('User', { id: 'self' } as never)
    expect(ability.can(Action.Read, own, 'email')).toBe(true)
    expect(ability.can(Action.Read, own, 'passwordHash')).toBe(false)
    expect(ability.can(Action.Update, own, 'name')).toBe(name !== 'VIEWER')
    expect(ability.can(Action.Update, own, 'systemRole')).toBe(false)
    expect(context.teamAccess.ownerTrusted).toBe(name === 'ADMIN')
  }
})

it('explicit safe fields match the public response/profile schemas in every locale topology', () => {
  expect([...ORG_READ_FIELDS].sort()).toEqual(Object.keys(orgResponseSchema.shape).sort())
  expect([...ORG_READ_FIELDS].sort()).toEqual(
    Object.values(Prisma.OrganizationScalarFieldEnum).sort()
  )
  expect([...OWN_USER_READ_FIELDS].sort()).toEqual(Object.keys(userResponseSchema.shape).sort())
  expect([...OWN_USER_UPDATE_FIELDS].sort()).toEqual(Object.keys(updateProfileSchema.shape).sort())
})
