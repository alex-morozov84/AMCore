import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

import { OrganizationCreationService } from '../src/core/organizations/organization-creation.service'
import type { SetupOperator } from '../src/core/organizations/organization-setup-admission'
import { OrganizationSetupOperations } from '../src/core/organizations/organization-setup-operations'
import { seedOrgRoles } from '../src/core/system-seed/seed-org-roles'
import { EnvService } from '../src/env/env.service'
import type { PrismaService } from '../src/prisma'

import {
  creationTableBarrier,
  setupTableBarrier,
  waitForDatabaseWaiter,
} from './establishment-race-barrier'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'
import { seedDomainOperatorSession } from './operator-auth.fixture.js'

describe('Organization establishment serialization (e2e)', () => {
  let context: E2ETestContext
  let userId: string
  const intent = () => ({ name: 'Initial company', slug: 'initial', adminUserId: userId })
  const setup = () => new OrganizationSetupOperations(context.prisma, false)
  async function operator(): Promise<SetupOperator> {
    const user = await context.prisma.user.create({
      data: {
        email: 'operator@example.test',
        emailCanonical: 'operator@example.test',
        systemRole: 'SUPER_ADMIN',
      },
    })
    const session = await context.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        refreshToken: randomUUID(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    return {
      principal: await seedDomainOperatorSession(context, session.id),
      freshWindowSeconds: 300,
    }
  }
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(context.prisma)
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    const user = await context.prisma.user.create({
      data: {
        email: 'staff@example.test',
        emailCanonical: 'staff@example.test',
        emailVerified: true,
      },
    })
    userId = user.id
  })

  it('waits for an earlier ordinary organization insert, then refuses initial creation', async () => {
    const writer = new Client({ connectionString: context.postgresContainer.getConnectionUri() })
    await writer.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(
        'INSERT INTO core.organizations (id,name,slug,"updatedAt") VALUES ($1,$2,$3,NOW())',
        ['ordinary', 'Ordinary', 'ordinary']
      )
      const outcome = setup()
        .bootstrap(intent())
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        )
      await waitForDatabaseWaiter(context.prisma)
      await writer.query('COMMIT')
      expect(await outcome).toMatchObject({ error: { errorCode: 'SETUP_CLOSED' } })
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(0)
    } finally {
      await writer.query('ROLLBACK')
      await writer.end()
    }
  })

  it('setup winning first fences a later ordinary insert until commit, without claiming permanent singleton policy', async () => {
    const barrier = setupTableBarrier(context.prisma)
    const first = new OrganizationSetupOperations(barrier.db, false).bootstrap(intent())
    try {
      await barrier.acquired
      const ordinary = context.app
        .get(OrganizationCreationService)
        .create(userId, { name: 'Later', slug: 'later' }, randomUUID())
      await waitForDatabaseWaiter(context.prisma)
      barrier.release()
      await first
      await ordinary
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(1)
      expect(await context.prisma.organization.count()).toBe(2)
    } finally {
      barrier.release()
      await first.catch(() => undefined)
    }
  })

  it('completion winning first closes queued account preparation without creating a user', async () => {
    const barrier = setupTableBarrier(context.prisma)
    const first = new OrganizationSetupOperations(barrier.db, false).bootstrap(intent())
    try {
      await barrier.acquired
      const prepared = setup()
        .prepare({ email: 'late@example.test' })
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        )
      await waitForDatabaseWaiter(context.prisma)
      barrier.release()
      await first
      expect(await prepared).toMatchObject({ error: { errorCode: 'SETUP_CLOSED' } })
      expect(
        await context.prisma.user.count({ where: { emailCanonical: 'late@example.test' } })
      ).toBe(0)
    } finally {
      barrier.release()
      await first.catch(() => undefined)
    }
  })

  it('preparation winning first leaves only an ordinary account when another recipient completes setup', async () => {
    const barrier = setupTableBarrier(context.prisma)
    const first = new OrganizationSetupOperations(barrier.db, false).prepare({
      email: 'earlier@example.test',
    })
    try {
      await barrier.acquired
      const completed = setup().bootstrap(intent())
      await waitForDatabaseWaiter(context.prisma)
      barrier.release()
      const account = await first
      await completed
      expect(await context.prisma.user.findUnique({ where: { id: account.userId } })).toMatchObject(
        { systemRole: 'USER', emailVerified: false, passwordHash: null }
      )
      expect(await context.prisma.orgMember.count({ where: { userId: account.userId } })).toBe(0)
    } finally {
      barrier.release()
      await first.catch(() => undefined)
    }
  })

  it('two concurrent identical initial commands yield one creation and one verified replay', async () => {
    const outcomes = await Promise.all([setup().bootstrap(intent()), setup().bootstrap(intent())])
    expect(outcomes.map((row) => row.status).sort()).toEqual(['already_completed', 'created'])
    expect(outcomes[0]!.ids).toEqual(outcomes[1]!.ids)
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'org.created', organizationId: outcomes[0]!.ids.organizationId },
      })
    ).toBe(1)
  })

  it('read-only replay does not wait on an existing ACL writer parent row while holding the setup table lock', async () => {
    const completed = await setup().bootstrap(intent())
    const writer = new Client({ connectionString: context.postgresContainer.getConnectionUri() })
    await writer.connect()
    const barrier = setupTableBarrier(context.prisma)
    try {
      await writer.query('BEGIN')
      await writer.query('SELECT id FROM core.organizations WHERE id = $1 FOR UPDATE', [
        completed.ids.organizationId,
      ])
      const replay = new OrganizationSetupOperations(barrier.db, false).bootstrap(intent())
      await barrier.acquired
      const update = writer.query(
        'UPDATE core.organizations SET "aclVersion" = "aclVersion" + 1 WHERE id = $1',
        [completed.ids.organizationId]
      )
      await waitForDatabaseWaiter(context.prisma)
      barrier.release()
      await update
      await writer.query('COMMIT')
      expect((await replay).status).toBe('already_completed')
    } finally {
      barrier.release()
      await writer.query('ROLLBACK')
      await writer.end()
    }
  })

  it('observes a target deletion that wins before verified identity admission', async () => {
    const writer = new Client({ connectionString: context.postgresContainer.getConnectionUri() })
    await writer.connect()
    try {
      await writer.query('BEGIN')
      await writer.query('DELETE FROM core.users WHERE id = $1', [userId])
      const pending = setup()
        .bootstrap(intent())
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        )
      await waitForDatabaseWaiter(context.prisma)
      await writer.query('COMMIT')
      expect(await pending).toMatchObject({ error: { errorCode: 'SETUP_ACCOUNT_UNAVAILABLE' } })
      expect(await context.prisma.organization.count()).toBe(0)
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(0)
    } finally {
      await writer.query('ROLLBACK')
      await writer.end()
    }
  })

  it('rolls organization, grant and permanent result back when strict audit fails before commit', async () => {
    await context.prisma.$executeRawUnsafe(
      `CREATE FUNCTION core.establishment_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture audit failure'; END $$`
    )
    await context.prisma.$executeRawUnsafe(
      `CREATE TRIGGER establishment_test_audit_failure BEFORE INSERT ON core.audit_log FOR EACH ROW WHEN (NEW.action = 'org.created') EXECUTE FUNCTION core.establishment_test_audit_failure()`
    )
    try {
      await expect(setup().bootstrap(intent())).rejects.toMatchObject({
        errorCode: 'SETUP_UNCONFIRMED',
      })
      expect(await context.prisma.organization.count()).toBe(0)
      expect(await context.prisma.orgMember.count()).toBe(0)
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(0)
    } finally {
      await context.prisma.$executeRawUnsafe(
        'DROP TRIGGER establishment_test_audit_failure ON core.audit_log'
      )
      await context.prisma.$executeRawUnsafe(
        'DROP FUNCTION core.establishment_test_audit_failure()'
      )
    }
    expect((await setup().bootstrap(intent())).status).toBe('created')
  })

  it('rechecks family revocation after setup lock waits through the transaction client', async () => {
    const admission = await operator()
    const barrier = setupTableBarrier(context.prisma)
    const pending = new OrganizationSetupOperations(barrier.db, false)
      .bootstrap(intent(), admission)
      .then(
        (value) => ({ value }),
        (error) => ({ error })
      )
    try {
      await barrier.acquired
      await context.prisma.authSessionFamily.update({
        where: { id: admission.principal.fid },
        data: { revokedAt: new Date() },
      })
      barrier.release()
      expect(await pending).toMatchObject({ error: { errorCode: 'SESSION_CHANGED' } })
      expect(await context.prisma.organization.count()).toBe(0)
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(0)
    } finally {
      barrier.release()
      await pending
    }
  })

  it('observes a system-role demotion that wins the shared authority lock before setup', async () => {
    const admission = await operator()
    const writer = new Client({ connectionString: context.postgresContainer.getConnectionUri() })
    await writer.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('system-role:SUPER_ADMIN', 0)::bigint)"
      )
      await writer.query('UPDATE core.users SET "systemRole" = $1 WHERE id = $2', [
        'USER',
        admission.principal.sub,
      ])
      const pending = setup()
        .prepare({ email: 'after-demotion@example.test' }, admission)
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        )
      await waitForDatabaseWaiter(context.prisma)
      await writer.query('COMMIT')
      expect(await pending).toMatchObject({ error: { errorCode: 'FORBIDDEN' } })
      expect(
        await context.prisma.user.count({
          where: { emailCanonical: 'after-demotion@example.test' },
        })
      ).toBe(0)
    } finally {
      await writer.query('ROLLBACK')
      await writer.end()
    }
  })

  it('serializes the real guarded seed behind setup using the common organization-first order', async () => {
    const barrier = setupTableBarrier(context.prisma)
    const pending = new OrganizationSetupOperations(barrier.db, false).bootstrap(intent())
    try {
      await barrier.acquired
      const seeded = seedOrgRoles(context.prisma)
      await waitForDatabaseWaiter(context.prisma)
      barrier.release()
      expect((await pending).status).toBe('created')
      await seeded
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(1)
    } finally {
      barrier.release()
      await pending.catch(() => undefined)
    }
  })

  it.each([false, true])(
    'serializes one self-service identity with changed intent=%s',
    async (changed) => {
      const barrier = creationTableBarrier(context.prisma)
      const service = new OrganizationCreationService(
        barrier.db as PrismaService,
        context.app.get(EnvService)
      )
      const id = randomUUID()
      const input = { name: 'Self service', slug: 'self-service' }
      const first = service.create(userId, input, id)
      try {
        await barrier.acquired
        const second = context.app
          .get(OrganizationCreationService)
          .create(userId, changed ? { name: 'Different', slug: 'different' } : input, id)
          .then(
            (value) => ({ value }),
            (error) => ({ error })
          )
        await waitForDatabaseWaiter(context.prisma)
        barrier.release()
        const created = await first
        expect(await second).toMatchObject(
          changed
            ? { error: { errorCode: 'ORGANIZATION_CREATION_INTENT_MISMATCH' } }
            : { value: { id: created.id } }
        )
        expect(await context.prisma.organization.count()).toBe(1)
        expect(await context.prisma.organizationCreationResult.count()).toBe(1)
        expect(await context.prisma.orgMember.count()).toBe(1)
        expect(
          await context.prisma.auditLog.count({
            where: { action: 'org.created', organizationId: created.id },
          })
        ).toBe(1)
      } finally {
        barrier.release()
        await first.catch(() => undefined)
      }
    }
  )

  it('scopes the same operation ID to each actor', async () => {
    const other = await context.prisma.user.create({
      data: { email: 'other@example.test', emailCanonical: 'other@example.test' },
    })
    const id = randomUUID()
    const service = context.app.get(OrganizationCreationService)
    const created = await Promise.all([
      service.create(userId, { name: 'First', slug: 'first' }, id),
      service.create(other.id, { name: 'Second', slug: 'second' }, id),
    ])
    expect(created[0]!.id).not.toBe(created[1]!.id)
    expect(await service.result(userId, id)).toMatchObject({ organizationId: created[0]!.id })
    expect(await service.result(other.id, id)).toMatchObject({ organizationId: created[1]!.id })
    expect(await context.prisma.organizationCreationResult.count()).toBe(2)
  })
})
