import { subject } from '@casl/ability'

import type { AppAbility } from '../src/core/auth/casl/ability.factory'
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
