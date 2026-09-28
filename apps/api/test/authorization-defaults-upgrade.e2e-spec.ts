import { seedOrgRoles } from '../prisma/seed-org-roles'
import {
  ORG_DEFAULT_PERMISSIONS,
  ORG_DEFAULT_ROLE_GRANTS,
} from '../src/core/auth/casl/org-role-defaults'

import {
  type AuthorizationDbFixture,
  authorizationDbFixture,
  DEFAULTS_MIGRATION,
  defaultsMigrationSql,
} from './authorization-db.fixture'
import { permissionSignature, seedLegacyAuthorization } from './authorization-legacy.fixture'

async function apply(db: AuthorizationDbFixture): Promise<void> {
  const connection = await db.pool.connect()
  try {
    await connection.query(defaultsMigrationSql())
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
  }
}

describe('Controlled defaults upgrade (real PostgreSQL and production CLI)', () => {
  let db: AuthorizationDbFixture
  beforeAll(async () => {
    db = await authorizationDbFixture()
  }, 120000)
  afterAll(async () => {
    if (db) await db.close()
  }, 120000)
  beforeEach(async () => {
    await db.pool.query(
      'DROP TRIGGER IF EXISTS upgrade_fault ON core.organizations; DROP FUNCTION IF EXISTS core.authorization_upgrade_fault(); DROP TRIGGER IF EXISTS seed_fault ON core.roles; DROP FUNCTION IF EXISTS core.authorization_seed_fault()'
    )
    await db.reset()
  })

  it('REAL production seed creates exact defaults, reruns unchanged, and shared writer serializes', async () => {
    db.seedProcess()
    const ids = (await db.prisma.role.findMany()).map((role) => role.id).sort()
    db.seedProcess()
    await Promise.all([seedOrgRoles(db.prisma), seedOrgRoles(db.prisma)])
    expect((await db.prisma.role.findMany()).map((role) => role.id).sort()).toEqual(ids)
    expect(await db.prisma.permission.count()).toBe(6)
    expect(await db.prisma.rolePermission.count()).toBe(11)
    for (const [name, indexes] of Object.entries(ORG_DEFAULT_ROLE_GRANTS)) {
      const role = await db.prisma.role.findFirstOrThrow({
        where: { name },
        include: { permissions: true },
      })
      expect(role.permissions.map((link) => link.permissionId).sort()).toEqual(
        indexes.map((index) => ORG_DEFAULT_PERMISSIONS[index]!.id).sort()
      )
    }
  }, 120000)

  it('seed failure after permission writes rolls back the complete defaults transaction', async () => {
    await db.pool.query(`CREATE FUNCTION core.authorization_seed_fault() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'seed fault'; END $$;
      CREATE TRIGGER seed_fault BEFORE INSERT ON core.roles
      FOR EACH ROW EXECUTE FUNCTION core.authorization_seed_fault()`)
    await expect(seedOrgRoles(db.prisma)).rejects.toThrow('seed fault')
    expect(await db.prisma.role.count()).toBe(0)
    expect(await db.prisma.permission.count()).toBe(0)
    expect(await db.prisma.rolePermission.count()).toBe(0)
  })

  it('REAL migrate deploy upgrades exact legacy, preserving IDs/scopes and every affected version', async () => {
    const legacy = await seedLegacyAuthorization(db)
    const key = await db.prisma.apiKey.create({
      data: {
        name: 'Legacy fixture',
        shortToken: 'fixture...',
        keyHash: 'fixture...',
        salt: 'fixture...',
        scopes: ['manage:Organization'],
        userId: legacy.members[0]!.userId,
        organizationId: legacy.organizations[0]!.id,
      },
    })
    const before = await db.prisma.memberRole.findMany({ orderBy: { id: 'asc' } })
    // Disposable DB only: reproduce the pre-upgrade migration ledger.
    await db.pool.query('DELETE FROM public._prisma_migrations WHERE migration_name=$1', [
      DEFAULTS_MIGRATION,
    ])
    db.deploy()
    expect((await db.prisma.role.findMany()).map((role) => role.id).sort()).toEqual(
      legacy.roles.map((role) => role.id).sort()
    )
    expect(await db.prisma.memberRole.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
    expect(await db.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).toEqual(key)
    for (const org of legacy.organizations)
      expect(
        (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
      ).toBe(13)
    for (const expected of ORG_DEFAULT_PERMISSIONS) {
      const actual = await db.prisma.permission.findUniqueOrThrow({ where: { id: expected.id } })
      expect(permissionSignature(actual)).toEqual(
        permissionSignature({ ...expected, conditions: expected.conditions })
      )
    }
    db.deploy()
    await apply(db)
    for (const org of legacy.organizations)
      expect(
        (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
      ).toBe(13)
  }, 120000)

  it.each(['partial', 'duplicate', 'modified', 'custom-all', 'collision'])(
    'rejects %s state before writes',
    async (kind) => {
      const legacy = await seedLegacyAuthorization(db)
      if (kind === 'partial')
        await db.prisma.rolePermission.deleteMany({ where: { roleId: legacy.roles[0]!.id } })
      if (kind === 'duplicate')
        await db.prisma.role.create({ data: { name: 'ADMIN', isSystem: true } })
      if (kind === 'modified')
        await db.prisma.permission.update({
          where: { id: legacy.permissions[0]!.id },
          data: { fields: ['name'] },
        })
      if (kind === 'custom-all')
        await db.prisma.role.create({
          data: {
            name: 'Unsafe',
            organizationId: legacy.organizations[0]!.id,
            permissions: { create: { permissionId: legacy.permissions[6]!.id } },
          },
        })
      if (kind === 'collision')
        await db.prisma.permission.create({
          data: { ...ORG_DEFAULT_PERMISSIONS[5]!, conditions: undefined },
        })
      const before = await db.prisma.rolePermission.findMany({
        orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
      })
      await expect(apply(db)).rejects.toThrow()
      expect(
        await db.prisma.rolePermission.findMany({
          orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
        })
      ).toEqual(before)
      for (const org of legacy.organizations)
        expect(
          (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
        ).toBe(12)
      await expect(seedOrgRoles(db.prisma)).rejects.toThrow()
    }
  )

  it('failure after grant/link changes rolls back all permissions, links and versions', async () => {
    const legacy = await seedLegacyAuthorization(db)
    const links = await db.prisma.rolePermission.findMany({
      orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
    })
    await db.pool
      .query(`CREATE FUNCTION core.authorization_upgrade_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected upgrade failure'; END $$;
      CREATE TRIGGER upgrade_fault BEFORE UPDATE ON core.organizations FOR EACH ROW EXECUTE FUNCTION core.authorization_upgrade_fault()`)
    await expect(apply(db)).rejects.toThrow('injected upgrade failure')
    expect(await db.prisma.permission.count()).toBe(7)
    expect(
      await db.prisma.rolePermission.findMany({
        orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
      })
    ).toEqual(links)
    for (const org of legacy.organizations)
      expect(
        (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
      ).toBe(12)
  })

  it('clean migration is a no-op and exact-v2 rerun does not bump versions', async () => {
    await apply(db)
    expect(await db.prisma.role.count()).toBe(0)
    await seedOrgRoles(db.prisma)
    await apply(db)
    expect(await db.prisma.rolePermission.count()).toBe(11)
  })

  it('preserves old concrete permission rows referenced by custom roles', async () => {
    const legacy = await seedLegacyAuthorization(db)
    await db.prisma.role.create({
      data: {
        name: 'Concrete custom',
        organizationId: legacy.organizations[0]!.id,
        permissions: { create: { permissionId: legacy.permissions[0]!.id } },
      },
    })
    await apply(db)
    expect(
      await db.prisma.permission.findUnique({ where: { id: legacy.permissions[0]!.id } })
    ).not.toBeNull()
    expect(await db.prisma.permission.count()).toBe(7)
  })
  it('upgrade table locks fence membership writers from the affected-organization snapshot', async () => {
    const legacy = await seedLegacyAuthorization(db)
    const holder = await db.pool.connect()
    const migrator = await db.pool.connect()
    const writer = await db.pool.connect()
    await holder.query('SELECT pg_advisory_lock(170017099)')
    const pid = (await migrator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await db.pool
      .query(`CREATE FUNCTION core.authorization_upgrade_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(170017099); RETURN NEW; END $$;
      CREATE TRIGGER upgrade_fault BEFORE UPDATE ON core.organizations FOR EACH ROW EXECUTE FUNCTION core.authorization_upgrade_fault()`)
    const upgrade = migrator.query(defaultsMigrationSql()).then(
      () => null,
      (error: Error) => error
    )
    try {
      let waiting = false
      const deadline = Date.now() + 5000
      while (!waiting && Date.now() < deadline) {
        waiting = (
          await db.pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting",
            [pid]
          )
        ).rows[0].waiting
      }
      expect(waiting).toBe(true)
      await writer.query("SET lock_timeout='100ms'")
      await expect(
        writer.query('UPDATE core.org_members SET "userId"="userId" WHERE id=$1', [
          legacy.members[0]!.id,
        ])
      ).rejects.toThrow(/lock timeout/)
      await holder.query('SELECT pg_advisory_unlock(170017099)')
      expect(await upgrade).toBeNull()
      for (const org of legacy.organizations)
        expect(
          (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
        ).toBe(13)
    } finally {
      await holder.query('SELECT pg_advisory_unlock(170017099)')
      await upgrade
      holder.release()
      migrator.release()
      writer.release()
    }
  })
})
