import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { authMailClock, lockAuthMailTokens } from '../src/core/auth/auth-mail-token-lock'
import { TokenManagerService } from '../src/core/auth/token-manager.service'
import { EnvService } from '../src/env/env.service'
import { PrismaClient } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import { waitForEmailCondition } from './email-secrets.helpers'
import { migrateTestDatabase } from './helpers'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('Auth mail: real PostgreSQL issuance/use serialization and expiry after waits', () => {
  let postgres: StartedPostgreSqlContainer
  let db: PrismaClient
  let tokens: TokenManagerService
  let userId: string
  const logger = {
    setContext: () => undefined,
    warn: () => undefined,
    info: () => undefined,
  } as unknown as PinoLogger

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(postgres.getConnectionUri())
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgres.getConnectionUri() }),
    })
    await db.$connect()
    tokens = new TokenManagerService(
      db as PrismaService,
      new EnvService(
        new ConfigService({
          PASSWORD_RESET_EXPIRY_MINUTES: 15,
          EMAIL_VERIFICATION_EXPIRY_HOURS: 48,
        })
      ),
      logger
    )
  }, 120000)
  beforeEach(async () => {
    await db.user.deleteMany()
    userId = (
      await db.user.create({
        data: {
          email: 'token-races@e2e.amcore.test',
          emailCanonical: 'token-races@e2e.amcore.test',
        },
      })
    ).id
  })
  afterAll(async () => {
    await db?.$disconnect()
    await postgres?.stop()
  }, 60000)

  it.each(['password-reset', 'email-verification'] as const)(
    'concurrent %s issues leave exactly one unused token',
    async (kind) => {
      const issue = () =>
        kind === 'password-reset'
          ? tokens.generatePasswordResetToken(userId)
          : tokens.generateEmailVerificationToken(userId)
      const issued = await Promise.all([issue(), issue()])
      const rows =
        kind === 'password-reset'
          ? await db.passwordResetToken.findMany()
          : await db.emailVerificationToken.findMany()
      expect(rows).toHaveLength(2)
      expect(rows.filter((r) => !r.used)).toHaveLength(1)
      expect(new Set(issued.map((r) => r.token)).size).toBe(2)
    }
  )

  it.each(['password-reset', 'email-verification'] as const)(
    'concurrent %s consumption has one winner',
    async (kind) => {
      const issued =
        kind === 'password-reset'
          ? await tokens.generatePasswordResetToken(userId)
          : await tokens.generateEmailVerificationToken(userId)
      const use = () =>
        kind === 'password-reset'
          ? tokens.consumePasswordResetToken(issued.token)
          : tokens.consumeEmailVerificationToken(issued.token)
      const results = await Promise.allSettled([use(), use()])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
      const row =
        kind === 'password-reset'
          ? await db.passwordResetToken.findUniqueOrThrow({ where: { id: issued.id } })
          : await db.emailVerificationToken.findUniqueOrThrow({ where: { id: issued.id } })
      expect(row.used).toBe(true)
      expect(row.usedAt).not.toBeNull()
    }
  )

  it('invalidates only the reissued kind and refuses the superseded link', async () => {
    const old = await tokens.generatePasswordResetToken(userId)
    const verify = await tokens.generateEmailVerificationToken(userId)
    const current = await tokens.generatePasswordResetToken(userId)
    await expect(tokens.consumePasswordResetToken(old.token)).rejects.toMatchObject({
      errorCode: AuthErrorCode.TOKEN_INVALID,
    })
    await tokens.consumeEmailVerificationToken(verify.token)
    await tokens.consumePasswordResetToken(current.token)
  })

  it('evaluates expiry after waiting for the common user lock', async () => {
    const issued = await tokens.generatePasswordResetToken(userId)
    const [expiry] = await db.$queryRaw<
      { expiresAt: Date }[]
    >`UPDATE core.password_reset_tokens SET "expiresAt"=clock_timestamp()+interval '200 milliseconds' WHERE id=${issued.id} RETURNING "expiresAt"`
    const locked = deferred(),
      release = deferred()
    const holding = db.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, userId)
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const consuming = tokens.consumePasswordResetToken(issued.token)
    // Attach rejection immediately; the request is intentionally held until database expiry.
    const outcome = consuming.then(
      () => 'unexpected success',
      (error: unknown) => error
    )
    await waitForEmailCondition(async () => {
      const now = await authMailClock(db)
      return now >= expiry!.expiresAt
    }, 'token expiry behind advisory lock')
    release.resolve()
    await holding
    expect(await outcome).toMatchObject({ errorCode: AuthErrorCode.TOKEN_INVALID })
    expect((await db.passwordResetToken.findUniqueOrThrow({ where: { id: issued.id } })).used).toBe(
      false
    )
  })

  it('refuses a link that expires while recipient completion waits on its user row', async () => {
    const issued = await tokens.generatePasswordResetToken(userId)
    const [expiry] = await db.$queryRaw<
      { expiresAt: Date }[]
    >`UPDATE core.password_reset_tokens SET "expiresAt"=clock_timestamp()+interval '200 milliseconds' WHERE id=${issued.id} RETURNING "expiresAt"`
    const locked = deferred(),
      release = deferred()
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.users WHERE id=${userId} FOR UPDATE`
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const outcome = tokens.consumePasswordResetToken(issued.token).then(
      () => 'unexpected success',
      (error: unknown) => error
    )
    await waitForEmailCondition(
      async () => (await authMailClock(db)) >= expiry!.expiresAt,
      'token expiry behind user row'
    )
    release.resolve()
    await holding
    expect(await outcome).toMatchObject({ errorCode: AuthErrorCode.TOKEN_INVALID })
    expect((await db.passwordResetToken.findUniqueOrThrow({ where: { id: issued.id } })).used).toBe(
      false
    )
  })

  it('conditional token write checks expiry again after a token-row lock wait', async () => {
    const issued = await tokens.generateEmailVerificationToken(userId)
    const locked = deferred(),
      release = deferred()
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.email_verification_tokens WHERE id=${issued.id} FOR UPDATE`
      // The earlier reader sees the original future expiry, but the CAS must recheck this version.
      await tx.$executeRaw`UPDATE core.email_verification_tokens SET "expiresAt"=clock_timestamp()-interval '1 millisecond' WHERE id=${issued.id}`
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const checked = deferred()
    const consuming = db.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, userId)
      const query = tx.$queryRaw.bind(tx)
      const client = new Proxy(tx, {
        get(target, key) {
          if (key === '$queryRaw')
            return (...args: Parameters<typeof tx.$queryRaw>) => {
              if (String(args[0]).includes('core.email_verification_tokens')) checked.resolve()
              return query(...args)
            }
          return Reflect.get(target, key)
        },
      })
      return tokens.consumeLocked(client, issued.token, 'email-verification')
    })
    const outcome = consuming.then(
      () => 'unexpected success',
      (error: unknown) => error
    )
    await checked.promise
    release.resolve()
    await holding
    expect(await outcome).toMatchObject({ errorCode: AuthErrorCode.TOKEN_INVALID })
    expect(
      (await db.emailVerificationToken.findUniqueOrThrow({ where: { id: issued.id } })).used
    ).toBe(false)
  })

  it('keeps the token unused when the recipient update rolls back', async () => {
    const issued = await tokens.generatePasswordResetToken(userId)
    await expect(
      db.$transaction(async (tx) => {
        await lockAuthMailTokens(tx, userId)
        await tokens.consumeLocked(tx, issued.token, 'password-reset')
        await tx.user.update({ where: { id: userId }, data: { emailVerified: true } })
        throw new Error('controlled recipient write failure')
      })
    ).rejects.toThrow('controlled recipient write failure')
    expect((await db.passwordResetToken.findUniqueOrThrow({ where: { id: issued.id } })).used).toBe(
      false
    )
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(false)
  })

  it('rejects expiry during a token-row wait even when its holder changes no data', async () => {
    const issued = await tokens.generateEmailVerificationToken(userId)
    const expiresAt = new Date(Date.now() + 500)
    await db.emailVerificationToken.update({ where: { id: issued.id }, data: { expiresAt } })
    const locked = deferred(),
      release = deferred()
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.email_verification_tokens WHERE id=${issued.id} FOR UPDATE`
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const consuming = db.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, userId)
      return tokens.consumeLocked(tx, issued.token, 'email-verification')
    })
    const outcome = consuming.then(
      () => 'unexpected success',
      (error: unknown) => error
    )
    try {
      await waitForEmailCondition(async () => {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%core.email_verification_tokens%') AS waiting`
        return row!.waiting
      }, 'actual token row wait')
      await waitForEmailCondition(async () => (await authMailClock(db)) >= expiresAt, 'expiry')
    } finally {
      release.resolve()
      await holding
    }
    expect(await outcome).toMatchObject({ errorCode: AuthErrorCode.TOKEN_INVALID })
    expect(
      (await db.emailVerificationToken.findUniqueOrThrow({ where: { id: issued.id } })).used
    ).toBe(false)
  })

  it('issues only after the target user lock and refuses verification after a completed confirmation', async () => {
    const locked = deferred(),
      release = deferred()
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.users WHERE id=${userId} FOR UPDATE`
      await tx.user.update({ where: { id: userId }, data: { emailVerified: true } })
      locked.resolve()
      await release.promise
    })
    await locked.promise
    const issuing = tokens.generateEmailVerificationToken(userId).then(
      () => 'unexpected success',
      (error: unknown) => error
    )
    release.resolve()
    await holding
    expect(await issuing).toMatchObject({ errorCode: AuthErrorCode.TOKEN_INVALID })
    expect(await db.emailVerificationToken.count()).toBe(0)
  })
})
