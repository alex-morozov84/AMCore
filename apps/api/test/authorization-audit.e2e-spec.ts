import { SystemRole } from '@amcore/shared'

import { seedOrgRoles } from '../prisma/seed-org-roles'
import { AbilityFactory } from '../src/core/auth/casl/ability.factory'

import {
  type AuthorizationDbFixture,
  authorizationDbFixture,
  defaultsMigrationSql,
} from './authorization-db.fixture'
import { seedLegacyAuthorization } from './authorization-legacy.fixture'

describe('Read-only audit and recovery rehearsal (real PostgreSQL)', () => {
  let db: AuthorizationDbFixture
  beforeAll(async () => {
    db = await authorizationDbFixture()
  }, 120000)
  afterAll(async () => {
    if (db) await db.close()
  }, 120000)
  beforeEach(async () => {
    await db.reset()
  })

  it('psql emits complete NDJSON, predicts explicit grants, exposes lockout and old scopes without PII', async () => {
    const legacy = await seedLegacyAuthorization(db)
    const org = legacy.organizations[0]!
    await db.prisma.apiKey.create({
      data: {
        name: 'Private name',
        shortToken: 'secret...',
        keyHash: 'secret...',
        salt: 'secret...',
        userId: legacy.members[0]!.userId,
        organizationId: org.id,
        scopes: ['manage:Organization'],
      },
    })
    const report = await db.audit()
    expect(report[0]?.templateState).toBe('legacy')
    expect(report.at(-1)?.complete).toBe(true)
    expect(report.at(-1)?.memberfulLockouts).toBe(2)
    const administrator = report.find(
      (row) => row.type === 'organization' && row.organizationId === org.id
    )!
    expect(administrator.structuralTeamCandidates).toBe(1)
    expect(administrator.runtimeProbeRequired).toBe(true)
    expect(report.filter((row) => row.type === 'key_scope_change')).toHaveLength(1)
    const text = JSON.stringify(report)
    expect(text).not.toMatch(/example\.com|secret\.\.\.|Private name|keyHash|shortToken|salt/)
    expect(await db.prisma.permission.count()).toBe(7)
    expect(
      (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
    ).toBe(12)
  })

  it('reports corrupt/duplicate/custom-all templates rather than silently inventing grants', async () => {
    const legacy = await seedLegacyAuthorization(db)
    await db.prisma.role.create({ data: { name: 'ADMIN', isSystem: true } })
    const report = await db.audit()
    expect(report[0]?.templateState).toBe('unsupported')
    expect(report.some((row) => row.code === 'UNSUPPORTED_TEMPLATES')).toBe(true)
    expect(report.at(-1)?.blockingFindings).toBeGreaterThan(0)
    expect(await db.prisma.role.count()).toBe(4)
    expect(legacy.roles).toHaveLength(3)
  })

  it('actual v2 DENY lockout is repaired by an explicit reviewed link removal and transactional version bump', async () => {
    const legacy = await seedLegacyAuthorization(db)
    await db.pool.query(defaultsMigrationSql())
    const member = legacy.members[0]!
    const restrictive = await db.prisma.role.create({
      data: {
        name: 'Restrictive',
        organizationId: member.organizationId,
        permissions: {
          create: {
            permission: {
              create: {
                action: 'read',
                subject: 'Role',
                inverted: true,
                organizationId: member.organizationId,
                conditions: { id: 'private-condition-value' },
                fields: ['name'],
              },
            },
          },
        },
      },
    })
    const assigned = await db.prisma.memberRole.create({
      data: { memberId: member.id, roleId: restrictive.id },
    })
    const before = await db.audit()
    expect(before[0]?.templateState).toBe('v2')
    expect(
      before.find((row) => row.type === 'member' && row.memberId === member.id)
        ?.structuralTeamAccess
    ).toBe(false)
    expect(JSON.stringify(before)).not.toContain('private-condition-value')
    const version = (
      await db.prisma.organization.findUniqueOrThrow({ where: { id: member.organizationId } })
    ).aclVersion
    await db.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'org:last-admin:' + member.organizationId}))`
      await tx.$queryRaw`SELECT id FROM core.organizations WHERE id=${member.organizationId} FOR UPDATE`
      const verified = await tx.orgMember.findUniqueOrThrow({ where: { id: member.id } })
      expect(verified.organizationId).toBe(member.organizationId)
      await tx.memberRole.delete({ where: { id: assigned.id } })
      await tx.organization.update({
        where: { id: member.organizationId },
        data: { aclVersion: { increment: 1 } },
      })
    })
    const after = await db.audit()
    expect(
      after.find((row) => row.type === 'member' && row.memberId === member.id)?.structuralTeamAccess
    ).toBe(true)
    expect(
      (await db.prisma.organization.findUniqueOrThrow({ where: { id: member.organizationId } }))
        .aclVersion
    ).toBe(version + 1)
    expect(await db.prisma.role.findUnique({ where: { id: restrictive.id } })).not.toBeNull()
    expect(
      await db.prisma.memberRole.count({
        where: { memberId: member.id, roleId: legacy.roles[0]!.id },
      })
    ).toBe(1)
    const ownerRules = (
      await db.prisma.memberRole.findMany({
        where: { memberId: member.id },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      })
    ).flatMap((link) => link.role.permissions.map((item) => item.permission))
    const factory = new AbilityFactory(
      { getPermissions: async () => ownerRules } as never,
      { getCurrent: async () => version + 1 } as never
    )
    expect(
      (
        await factory.createAuthorizationContext({
          type: 'jwt',
          sub: member.userId,
          organizationId: member.organizationId,
          aclVersion: 0,
          systemRole: SystemRole.User,
        })
      ).teamAccess.ownerTrusted
    ).toBe(true)
  })

  it('SQL positive eligibility stays an upper bound: native parser failure rejects an actual owner', async () => {
    await seedOrgRoles(db.prisma)
    const email = 'fixture@example.com'
    const user = await db.prisma.user.create({ data: { email, emailCanonical: email } })
    const org = await db.prisma.organization.create({ data: { name: 'Probe', slug: 'probe' } })
    const admin = await db.prisma.role.findFirstOrThrow({
      where: { name: 'ADMIN', organizationId: null },
    })
    const custom = await db.prisma.role.create({
      data: {
        name: 'Parser fault',
        organizationId: org.id,
        permissions: {
          create: {
            permission: {
              create: {
                action: 'read',
                subject: 'Organization',
                organizationId: org.id,
                conditions: { id: { unknownOperator: 'private-parser-value' } },
              },
            },
          },
        },
      },
    })
    const member = await db.prisma.orgMember.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        roles: { create: [{ roleId: admin.id }, { roleId: custom.id }] },
      },
    })
    const report = await db.audit()
    expect(
      report.find((row) => row.type === 'member' && row.memberId === member.id)
        ?.structuralTeamAccess
    ).toBe(true)
    const rules = (
      await db.prisma.memberRole.findMany({
        where: { memberId: member.id },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      })
    ).flatMap((link) => link.role.permissions.map((item) => item.permission))
    const factory = new AbilityFactory(
      { getPermissions: async () => rules } as never,
      { getCurrent: async () => 0 } as never
    )
    await expect(
      factory.createAuthorizationContext({
        type: 'jwt',
        sub: user.id,
        organizationId: org.id,
        aclVersion: 0,
        systemRole: SystemRole.User,
      })
    ).rejects.toThrow()
  })
  it('exact psql report works with SELECT-only table rights', async () => {
    await seedOrgRoles(db.prisma)
    await db.pool.query(
      'CREATE ROLE authorization_auditor; GRANT USAGE ON SCHEMA core TO authorization_auditor; GRANT SELECT ON ALL TABLES IN SCHEMA core TO authorization_auditor'
    )
    const report = await db.audit(true)
    expect(report[0]?.templateState).toBe('v2')
    expect(report.at(-1)?.complete).toBe(true)
  })
})
