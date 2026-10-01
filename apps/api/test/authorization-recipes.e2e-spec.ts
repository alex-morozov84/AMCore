import { subject } from '@casl/ability'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import type { AppAbility } from '../src/core/auth/casl/ability.factory'
import { normalizeOwnerPermissions } from '../src/core/auth/casl/permission-normalization'
import { validatePermissionRule } from '../src/core/auth/casl/permission-rule-validation'
import {
  accessibleBy,
  createCaslExtension,
  createPrismaAbility,
} from '../src/core/auth/casl/prisma-ability'
import { Prisma } from '../src/generated/prisma/client'

import { type AuthorizationDbFixture, authorizationDbFixture } from './authorization-db.fixture'
import { ROLE_SCALAR_FIELDS, roleAuthorizationRecipe } from './recipes/role-authorization.recipe'

const ability = (rules: AppAbility['rules']) => createPrismaAbility<AppAbility>(rules)

describe('Bounded Prisma recipe (real PostgreSQL)', () => {
  let db: AuthorizationDbFixture
  let org: string
  let role: string
  let foreign: string
  beforeAll(async () => {
    db = await authorizationDbFixture()
  }, 120000)
  afterAll(async () => {
    if (db) await db.close()
  }, 120000)
  beforeEach(async () => {
    await db.reset()
    const ownOrg = await db.prisma.organization.create({ data: { name: 'Own', slug: 'own' } })
    const foreignOrg = await db.prisma.organization.create({
      data: { name: 'Foreign', slug: 'foreign' },
    })
    org = ownOrg.id
    role = (
      await db.prisma.role.create({
        data: { name: 'Before', description: 'Private', organizationId: org },
      })
    ).id
    foreign = (
      await db.prisma.role.create({ data: { name: 'Foreign', organizationId: foreignOrg.id } })
    ).id
  })
  const recipe = (rules: AppAbility['rules']) =>
    roleAuthorizationRecipe(db.prisma as never, ability(rules), org)

  it('scalar coverage matches the generated model, so adding fields requires review', () => {
    expect([...ROLE_SCALAR_FIELDS].sort()).toEqual(Object.values(Prisma.RoleScalarFieldEnum).sort())
  })

  const partialDeleteCases: { rules: AppAbility['rules'] }[] = [
    { rules: [{ action: 'delete', subject: 'Role', fields: ['name'] }] },
    {
      rules: [
        { action: 'delete', subject: 'Role' },
        { action: 'delete', subject: 'Role', fields: ['name'], inverted: true },
      ],
    },
  ]
  it.each(partialDeleteCases)(
    'R1 denies row deletion when even one scalar is unauthorized',
    async ({ rules }) => {
      const before = await db.prisma.role.findUniqueOrThrow({ where: { id: role } })
      await expect(recipe(rules).remove(role)).rejects.toThrow('permission denied')
      expect(await db.prisma.role.findUniqueOrThrow({ where: { id: role } })).toEqual(before)
    }
  )

  it('unrestricted row delete succeeds, foreign tenant delete fails', async () => {
    const fixture = recipe([{ action: 'delete', subject: 'Role' }])
    await expect(fixture.remove(foreign)).rejects.toThrow()
    expect(await db.prisma.role.findUnique({ where: { id: foreign } })).not.toBeNull()
    await fixture.remove(role)
    expect(await db.prisma.role.findUnique({ where: { id: role } })).toBeNull()
  })

  it('no-rules and all-deny use nested empty OR safely through the extension, including transactions', async () => {
    const cases: AppAbility['rules'][] = [
      [],
      [{ action: 'manage', subject: 'Role', inverted: true }],
    ]
    for (const rules of cases) {
      const fixture = recipe(rules)
      expect(await fixture.list()).toEqual([])
      expect(await fixture.count()).toBe(0)
      await expect(fixture.read(role)).rejects.toThrow()
      await expect(fixture.update(role, { name: 'Denied' })).rejects.toThrow()
      await expect(fixture.remove(role)).rejects.toThrow()
    }
  })

  it('conditions, tenant AND, projection and field-limited updates compose without a new pool', async () => {
    const rules: AppAbility['rules'] = [
      {
        action: 'read',
        subject: 'Role',
        fields: ['id', 'name'],
        conditions: { name: { not: 'Excluded' } },
      },
      {
        action: 'update',
        subject: 'Role',
        fields: ['name'],
        conditions: { name: { not: 'Blocked' } },
      },
    ]
    const fixture = recipe(rules)
    expect(await fixture.count()).toBe(1)
    expect(await fixture.list()).toEqual([{ id: role, name: 'Before' }])
    expect(await fixture.read(role)).toEqual({ id: role, name: 'Before' })
    await expect(fixture.read(foreign)).rejects.toThrow()
    await fixture.update(role, { name: 'After' })
    await expect(
      fixture.update(role, { name: 'Must rollback', description: 'Forbidden' })
    ).rejects.toThrow()
    await expect(fixture.update(role, { organizationId: 'foreign' })).rejects.toThrow()
    await expect(fixture.update(role, { name: 'Blocked' })).rejects.toThrow()
    const actual = await db.prisma.role.findUniqueOrThrow({ where: { id: role } })
    expect(actual.name).toBe('After')
    expect(actual.description).toBe('Private')
    expect(ability(rules).can('read', subject('Role', actual), 'description')).toBe(false)
  })

  it('unreadable ID omits rows and denies direct read while count remains row authority', async () => {
    const fixture = recipe([{ action: 'read', subject: 'Role', fields: ['name'] }])
    expect(await fixture.list()).toEqual([])
    expect(await fixture.count()).toBe(1)
    await expect(fixture.read(role)).rejects.toThrow()
  })
  it('extension handles both tenant AND orders, including the no-access OR:[]', async () => {
    const client = db.prisma.$extends(createCaslExtension())
    for (const rules of [[], [{ action: 'read', subject: 'Role' as const }]]) {
      const filter = accessibleBy(ability(rules)).ofType('Role')
      for (const terms of [
        [filter, { organizationId: org }],
        [{ organizationId: org }, filter],
      ]) {
        expect(await client.role.count({ where: { AND: terms } })).toBe(rules.length ? 1 : 0)
      }
    }
  })

  it('normalizes stored epoch dates before CASL and PostgreSQL list/count, including DENY', async () => {
    const row = await db.prisma.organization.findUniqueOrThrow({ where: { id: org } })
    const epoch = row.createdAt.getTime()
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: 'holder',
      organizationId: org,
      aclVersion: 1,
      systemRole: SystemRole.User,
    }
    const cases = [
      { createdAt: epoch },
      { createdAt: { gte: epoch } },
      { OR: [{ createdAt: { in: [epoch] } }, { id: 'never' }] },
      { NOT: { createdAt: { notIn: [epoch] } } },
    ]
    const client = db.prisma.$extends(createCaslExtension())
    for (const conditions of cases) {
      const [permission] = normalizeOwnerPermissions(
        [
          {
            id: 'date-allow',
            action: Action.Read,
            subject: Subject.Organization,
            conditions,
            fields: [],
            inverted: false,
          },
        ],
        principal
      )
      const ability = createPrismaAbility<AppAbility>([
        {
          action: Action.Read,
          subject: Subject.Organization,
          conditions: permission!.conditions as never,
        },
      ])
      expect(ability.can(Action.Read, subject('Organization', row))).toBe(true)
      const where = { AND: [accessibleBy(ability).ofType('Organization'), { id: org }] }
      expect((await client.organization.findMany({ where })).map((item) => item.id)).toEqual([org])
      expect(await client.organization.count({ where })).toBe(1)
    }
    const normalized = normalizeOwnerPermissions(
      [
        {
          id: 'allow',
          action: Action.Read,
          subject: Subject.Organization,
          conditions: null,
          fields: [],
          inverted: false,
        },
        {
          id: 'deny',
          action: Action.Read,
          subject: Subject.Organization,
          conditions: { createdAt: { gte: epoch } },
          fields: [],
          inverted: true,
        },
      ],
      principal
    )
    const ability = createPrismaAbility<AppAbility>(
      normalized.map((permission) => ({
        action: permission.action as Action,
        subject: permission.subject as Subject.Organization,
        inverted: permission.inverted,
        ...(permission.conditions === null ? {} : { conditions: permission.conditions as never }),
      }))
    )
    expect(ability.can(Action.Read, subject('Organization', row))).toBe(false)
    const where = { AND: [accessibleBy(ability).ofType('Organization'), { id: org }] }
    expect(await client.organization.findMany({ where })).toEqual([])
    expect(await client.organization.count({ where })).toBe(0)
  })

  it('accepted advanced operators agree across validation, CASL and PostgreSQL', async () => {
    const row = await db.prisma.role.findUniqueOrThrow({ where: { id: role } })
    const cases: Record<string, unknown>[] = [
      { name: 'Before' },
      { name: { not: 'Other' } },
      { name: { in: ['Before', 'Other'] } },
      { name: { notIn: ['Other'] } },
      { name: { contains: 'for' } },
      { name: { startsWith: 'Be' } },
      { name: { endsWith: 'ore' } },
      { isSystem: false },
      { AND: [{ name: 'Before' }, { isSystem: false }] },
      { OR: [{ name: 'Other' }, { name: 'Before' }] },
      { NOT: { name: 'Other' } },
    ]
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: 'holder',
      organizationId: org,
      aclVersion: 1,
      systemRole: SystemRole.User,
    }
    const client = db.prisma.$extends(createCaslExtension())
    for (const conditions of cases) {
      const input = {
        action: Action.Read,
        subject: Subject.Role,
        conditions,
        fields: ['id', 'name'],
        inverted: false,
      }
      expect(() => validatePermissionRule(input)).not.toThrow()
      const [permission] = normalizeOwnerPermissions([{ id: 'rule', ...input }], principal)
      const rule = {
        action: Action.Read,
        subject: Subject.Role,
        conditions: permission!.conditions as never,
        fields: ['id', 'name'],
      }
      const current = createPrismaAbility<AppAbility>([rule])
      expect(current.can(Action.Read, subject('Role', row), 'name')).toBe(true)
      const where = { AND: [accessibleBy(current).ofType('Role'), { organizationId: org }] }
      expect((await client.role.findMany({ where })).map((item) => item.id)).toEqual([role])
      expect(await client.role.count({ where })).toBe(1)
    }
  })

  it('nullable DateTime and integer ACL conditions agree across CASL and PostgreSQL', async () => {
    const user = await db.prisma.user.create({
      data: { email: 'date-rule@fixture.test', emailCanonical: 'date-rule@fixture.test' },
    })
    const datedUser = await db.prisma.user.create({
      data: {
        email: 'dated-rule@fixture.test',
        emailCanonical: 'dated-rule@fixture.test',
        lastLoginAt: new Date(946684800000),
      },
    })
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: user.id,
      organizationId: org,
      aclVersion: 0,
      systemRole: SystemRole.User,
    }
    const client = db.prisma.$extends(createCaslExtension())
    const verifyUser = async (current: AppAbility, row: typeof user, field: string) => {
      expect(current.can(Action.Read, subject('User', row), field)).toBe(true)
      const where = { AND: [accessibleBy(current).ofType('User'), { id: row.id }] }
      expect((await client.user.findMany({ where })).map((item) => item.id)).toEqual([row.id])
      expect(await client.user.count({ where })).toBe(1)
    }
    const verifyOrganization = async (
      current: AppAbility,
      row: Awaited<ReturnType<typeof db.prisma.organization.findUniqueOrThrow>>,
      field: string
    ) => {
      expect(current.can(Action.Read, subject('Organization', row), field)).toBe(true)
      const where = { AND: [accessibleBy(current).ofType('Organization'), { id: org }] }
      expect((await client.organization.findMany({ where })).map((item) => item.id)).toEqual([org])
      expect(await client.organization.count({ where })).toBe(1)
    }
    for (const [ruleSubject, conditions, field, row] of [
      [Subject.User, { lastLoginAt: null }, 'lastLoginAt', user],
      [Subject.User, { lastLoginAt: { gte: 946684800000 } }, 'lastLoginAt', datedUser],
      [
        Subject.Organization,
        { aclVersion: 0 },
        'aclVersion',
        await db.prisma.organization.findUniqueOrThrow({ where: { id: org } }),
      ],
    ] as const) {
      const input = { action: Action.Read, subject: ruleSubject, conditions, fields: [field] }
      expect(() => validatePermissionRule(input)).not.toThrow()
      const [normalized] = normalizeOwnerPermissions(
        [{ id: 'scalar', ...input, inverted: false }],
        principal
      )
      const current = createPrismaAbility<AppAbility>([
        {
          action: Action.Read,
          subject: ruleSubject,
          conditions: normalized!.conditions as never,
          fields: [field],
        },
      ])
      if (ruleSubject === Subject.User) {
        await verifyUser(current, row, field)
      } else {
        await verifyOrganization(current, row, field)
      }
    }
  })

  it.each(['update', 'delete'])(
    'row lock checks current facts after a concurrent change for %s',
    async (action) => {
      const holder = await db.pool.connect()
      await holder.query('BEGIN')
      await holder.query('SELECT id FROM core.roles WHERE id=$1 FOR UPDATE', [role])
      await holder.query('UPDATE core.roles SET name=$1 WHERE id=$2', ['Blocked', role])
      const fixture = recipe([
        { action, subject: 'Role', conditions: { name: { not: 'Blocked' } } },
      ])
      const operation = (
        action === 'update' ? fixture.update(role, { name: 'Must not save' }) : fixture.remove(role)
      ).then(
        () => null,
        (error: Error) => error
      )
      try {
        const deadline = Date.now() + 5000
        let blocked = false
        while (!blocked && Date.now() < deadline) {
          blocked = (
            await db.pool.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM core.roles%') AS blocked"
            )
          ).rows[0].blocked
        }
        expect(blocked).toBe(true)
        await holder.query('COMMIT')
        expect(await operation).toBeInstanceOf(Error)
        expect((await db.prisma.role.findUniqueOrThrow({ where: { id: role } })).name).toBe(
          'Blocked'
        )
      } finally {
        await holder.query('ROLLBACK')
        holder.release()
        await operation
      }
    }
  )
})
