import { randomUUID } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'
import { Client } from 'pg'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import type { SetupOperator } from '../src/core/organizations/organization-setup-admission'
import { ProvisioningService } from '../src/core/organizations/provisioning/provisioning.service'
import { provisioningAdmissionDeadline } from '../src/core/organizations/provisioning/provisioning-admission-deadline'
import { ProvisioningLimiterService } from '../src/core/organizations/provisioning/provisioning-limiter.service'
import { type AppRedisClient, REDIS_CLIENT } from '../src/infrastructure/redis'

import { waitForDatabaseWaiter } from './establishment-race-barrier'
import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { boundedFailure } from './helpers/invitation-operation'
import { prepareProvisioningFixture } from './provisioning-fixture'
import { provisioningRedisTransport } from './provisioning-redis-transport'

const jest = import.meta.jest

describe('Provisioning transaction fences (e2e)', () => {
  let context: E2ETestContext
  let fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>
  const service = () => context.app.get(ProvisioningService)
  const operator = (): SetupOperator => ({
    principal: {
      ...context.app.get(JwtService).verify(fixture.token),
      type: 'jwt',
      systemRole: SystemRole.SuperAdmin,
    },
    freshWindowSeconds: 300,
  })
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    fixture = await prepareProvisioningFixture(context)
  })
  afterEach(() => {
    fixture?.restore()
    jest.restoreAllMocks()
  })

  it.each(['success', 'failure'] as const)(
    'rolls back on the application deadline, then ignores late Redis %s',
    async (late) => {
      let resolveReply!: (value: number) => void
      let rejectReply!: (error: Error) => void
      let expire!: () => void
      let entered!: () => void
      const waiting = new Promise<void>((resolve) => {
        entered = resolve
      })
      const reply = new Promise<number>((resolve, reject) => {
        resolveReply = resolve
        rejectReply = reject
      })
      let clock = 0
      const limiter = jest
        .spyOn(context.app.get(ProvisioningLimiterService), 'consume')
        .mockImplementation(async () => {
          const gate = provisioningAdmissionDeadline(() => reply, {
            now: () => clock,
            schedule: (callback) => {
              expire = callback
              return () => undefined
            },
          })
          entered()
          await gate
        })
      const input = { ...fixture.input(), inviteLocale: DEFAULT_LOCALE }
      const operation = service()
        .create(input, operator())
        .catch((error: unknown) => error)
      await waiting
      const actorAdmitted = jest.spyOn(context.prisma.organization, 'create')
      clock = 251
      expire()
      expect(await operation).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
      expect(await context.prisma.organization.count()).toBe(0)
      expect(await context.prisma.orgInvite.count()).toBe(0)
      expect(await context.prisma.organizationProvisioning.count()).toBe(0)
      if (late === 'success') resolveReply(1)
      else rejectReply(new Error('Late transport failure'))
      await Promise.resolve()
      await context.prisma.$queryRaw`SELECT 1`
      expect(actorAdmitted).not.toHaveBeenCalled()
      expect(await context.prisma.organization.count()).toBe(0)
      expect(await context.prisma.auditLog.count({ where: { action: 'org.created' } })).toBe(0)
      limiter.mockRestore()
    }
  )

  it('rechecks session revocation after waiting for the organization-table lock', async () => {
    const writer = new Client({ connectionString: context.postgresContainer.getConnectionUri() })
    await writer.connect()
    try {
      await writer.query('BEGIN')
      await writer.query('LOCK TABLE core.organizations IN SHARE ROW EXCLUSIVE MODE')
      const operation = service()
        .create({ ...fixture.input(), inviteLocale: DEFAULT_LOCALE }, operator())
        .catch((error: unknown) => error)
      await waitForDatabaseWaiter(context.prisma)
      const claims = context.app.get(JwtService).verify(fixture.token)
      await context.prisma.session.update({
        where: { id: claims.sid },
        data: { revokedAt: new Date() },
      })
      await writer.query('COMMIT')
      expect(await operation).toMatchObject({ errorCode: 'STEP_UP_REQUIRED' })
      expect(await context.prisma.organization.count()).toBe(0)
    } finally {
      await writer.query('ROLLBACK')
      await writer.end()
    }
  })
  it('removes a real installed-client queued command before transport sends it', async () => {
    const transport = await provisioningRedisTransport(context.redisContainer.getConnectionUrl())
    let expire!: () => void
    let now = 0
    const key = `rate:transport:${randomUUID()}`
    try {
      const result = provisioningAdmissionDeadline(
        (signal) =>
          transport.client
            .withCommandOptions({ abortSignal: signal, timeout: 250 })
            .eval("return redis.call('INCR',KEYS[1])", { keys: [key], arguments: [] }),
        {
          now: () => now,
          schedule: (callback) => {
            expire = callback
            return () => undefined
          },
        }
      ).catch((error: unknown) => error)
      now = 251
      expire()
      expect(await result).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(transport.evalWrites()).toBe(0)
      expect(await context.app.get<AppRedisClient>(REDIS_CLIENT).get(key)).toBeNull()
      expect(await transport.client.ping()).toBe('PONG')
    } finally {
      await transport.close()
    }
  })

  it.each(['success', 'failure'] as const)(
    'bounds real sent-command waiting and observes late %s',
    async (late) => {
      const transport = await provisioningRedisTransport(context.redisContainer.getConnectionUrl())
      let expire!: () => void
      let now = 0
      let replied!: () => void
      const settled = new Promise<void>((resolve) => {
        replied = resolve
      })
      const continuation = jest.fn()
      const key = `rate:transport:${randomUUID()}`
      try {
        transport.hold()
        const result = provisioningAdmissionDeadline(
          (signal) => {
            const raw = transport.client
              .withCommandOptions({ abortSignal: signal, timeout: 250 })
              .eval("return redis.call('INCR',KEYS[1])", { keys: [key], arguments: [] })
            void raw.then(
              () => replied(),
              () => replied()
            )
            return raw
          },
          {
            now: () => now,
            schedule: (callback) => {
              expire = callback
              return () => undefined
            },
          }
        ).then(continuation, (error: unknown) => error)
        await Promise.race([transport.reply, boundedFailure('Redis reply barrier')])
        expect(await context.app.get<AppRedisClient>(REDIS_CLIENT).get(key)).toBe('1')
        now = 251
        expire()
        expect(await result).toMatchObject({ errorCode: 'PROVISIONING_ADMISSION_UNAVAILABLE' })
        if (late === 'success') transport.release()
        else transport.fail()
        await Promise.race([settled, boundedFailure('Late Redis result')])
        expect(continuation).not.toHaveBeenCalled()
        expect(await context.app.get<AppRedisClient>(REDIS_CLIENT).ping()).toBe('PONG')
      } finally {
        await transport.close()
      }
    }
  )
})
