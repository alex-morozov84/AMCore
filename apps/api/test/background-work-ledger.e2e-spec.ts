import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ClsModule } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'
import { v7 as uuidv7 } from 'uuid'

import { type RequestPrincipal, SystemRole, type WorkCommand } from '@amcore/shared'

import { BackgroundCommandAdmission } from '../src/core/admin/background-command-admission'
import { BackgroundCommandService } from '../src/core/admin/background-command-service'
import { BackgroundCommandSettlement } from '../src/core/admin/background-command-settlement'
import { BackgroundControlAuthority } from '../src/core/admin/background-control-authority'
import { BackgroundControlBudgets } from '../src/core/admin/background-control-budgets'
import { BackgroundControlMaintenance } from '../src/core/admin/background-control-maintenance'
import { BackgroundControlReservations } from '../src/core/admin/background-control-reservations'
import { AuditLogService } from '../src/core/audit/audit-log.service'
import { EnvService } from '../src/env/env.service'
import { PrismaClient } from '../src/generated/prisma/client'
import { backgroundControlTransaction } from '../src/infrastructure/background-work/control-transaction'
import { PgOutcomeBuffer } from '../src/infrastructure/background-work/pg-outcome-buffer'
import {
  type ProviderAdmission,
  type ProviderAttempt,
  ProviderEvidenceStore,
} from '../src/infrastructure/background-work/provider-evidence.store'
import { PrismaService } from '../src/prisma'

import { importWork, ImportWorkAdapter } from './fixtures/background-work/import-fixture'
import { migrateTestDatabase, noopPinoLogger } from './helpers'

/** Real PG locks, migrations, session authority, bounded reservations and strict audit. No app/broker. */
describe('Background-work ADMIN ledger', () => {
  let container: StartedPostgreSqlContainer
  let prisma: PrismaClient
  let module: TestingModule
  let admission: BackgroundCommandAdmission
  let settlement: BackgroundCommandSettlement
  let evidence: ProviderEvidenceStore
  let principal: RequestPrincipal
  const revision = 'a'.repeat(64)

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    await migrateTestDatabase(container.getConnectionUri())
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    })
    await prisma.$connect()
    const recipeSql = await readFile(
      resolve(import.meta.dirname, '../../../docs/backend/recipes/db-owned-work.sql'),
      'utf8'
    )
    for (const statement of recipeSql.split(';').filter((part) => part.trim()))
      await prisma.$executeRawUnsafe(statement)
    module = await Test.createTestingModule({
      imports: [ClsModule.forRoot()],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: PinoLogger, useValue: noopPinoLogger },
        { provide: ConfigService, useValue: new ConfigService({ STEP_UP_MAX_AGE_SECONDS: 600 }) },
        EnvService,
        AuditLogService,
        BackgroundControlAuthority,
        BackgroundControlBudgets,
        BackgroundControlReservations,
        BackgroundCommandAdmission,
        BackgroundCommandSettlement,
        ProviderEvidenceStore,
        BackgroundCommandService,
        PgOutcomeBuffer,
        ImportWorkAdapter,
        BackgroundControlMaintenance,
      ],
    }).compile()
    await module.init()
    admission = module.get(BackgroundCommandAdmission)
    settlement = module.get(BackgroundCommandSettlement)
    evidence = module.get(ProviderEvidenceStore)
  }, 120_000)

  afterAll(async () => {
    await module?.close()
    await prisma?.$disconnect()
    await container?.stop()
  }, 60_000)

  beforeEach(async () => {
    await prisma.backgroundCommandTarget.deleteMany()
    await prisma.backgroundCommand.deleteMany()
    await prisma.backgroundWorkControl.deleteMany()
    await prisma.backgroundEffectEvidence.deleteMany()
    await prisma.backgroundBudget.deleteMany()
    await prisma.$executeRaw`TRUNCATE core.fixture_imports`
    await prisma.$executeRaw`UPDATE core.fixture_import_control SET paused = false, revision = 0 WHERE id = 1`
    // Audit remains append-only; each case gets a distinct actor and counts its own events.
    const email = `ledger-${uuidv7()}@example.test`
    const user = await prisma.user.create({
      data: { emailCanonical: email, email, systemRole: 'SUPER_ADMIN' },
    })
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        familyId: uuidv7(),
        refreshToken: uuidv7(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    principal = { type: 'jwt', sub: user.id, sid: session.id, systemRole: SystemRole.SuperAdmin }
  })

  function command(): WorkCommand {
    return {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: 'image',
      operation: 'pause',
      targets: [],
      expectedWorkRevision: revision,
      reason: 'Owner maintenance',
      parameters: {},
    }
  }
  const transaction: typeof backgroundControlTransaction = (client, action) =>
    backgroundControlTransaction(client, action)
  function prepare(input: WorkCommand) {
    return admission.admit(principal, input, 1, [
      {
        id: 'image',
        queueEpoch: uuidv7(),
        snapshot: { revision, controlRevision: 0, paused: false },
      },
    ])
  }

  it('runs all five durable operations with domain writes, receipt and strict audit in the same PG transaction', async () => {
    const adapter = module.get(ImportWorkAdapter)
    const service = module.get(BackgroundCommandService)
    const action = async (operation: WorkCommand['operation'], id?: string) => {
      const summary = await adapter.readSummary()
      const row = id ? await adapter.detail(id) : null
      const input: WorkCommand = {
        ...command(),
        workId: importWork.id,
        operation,
        expectedWorkRevision: summary.revision!,
        targets: row ? [row.identity] : [],
        parameters:
          operation === 'cleanup'
            ? { states: ['completed'], cutoff: new Date(Date.now() - 86401000).toISOString() }
            : {},
      }
      return service.executeDurable(principal, input, 1, adapter)
    }
    expect((await action('pause')).state).toBe('applied')
    expect(await adapter.claim()).toBeNull()
    expect((await action('resume')).state).toBe('applied')
    // Each HTTP-equivalent request consumes cost; reset only test rate clocks
    // between operations, preserving every quota/grant/receipt reservation.
    await prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    const failed = uuidv7(),
      pending = uuidv7(),
      terminal = uuidv7()
    await prisma.$executeRaw`INSERT INTO core.fixture_imports (id, incarnation, state, attempts, finished)
      VALUES ('failed', ${failed}::uuid, 'failed', 3, NOW()),
        ('pending', ${pending}::uuid, 'waiting', 0, NULL),
        ('terminal', ${terminal}::uuid, 'completed', 1, NOW() - INTERVAL '2 days')`
    expect((await action('retry', 'failed')).state).toBe('applied')
    expect((await adapter.detail('failed'))?.manualGrant).toBe('spent')
    expect((await action('cancel', 'pending')).state).toBe('applied')
    expect(await adapter.detail('pending')).toBeNull()
    expect((await action('cleanup', 'terminal')).state).toBe('applied')
    expect(await adapter.detail('terminal')).toBeNull()
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_intent' },
      })
    ).toBe(5)
    expect(await prisma.backgroundEffectEvidence.count()).toBe(0)
  })

  it('rolls durable business mutation back with strict outcome audit, then replay only reads the retained intent', async () => {
    const adapter = module.get(ImportWorkAdapter)
    const service = module.get(BackgroundCommandService)
    const input = {
      ...command(),
      workId: importWork.id,
      expectedWorkRevision: (await adapter.readSummary()).revision!,
    }
    const audit = module.get(AuditLogService)
    const record = audit.record.bind(audit)
    let businessWriteObserved = false
    const injected = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      if (
        args[0].action === 'background_work.command_outcome' &&
        args[0].metadata?.outcome === 'applied'
      ) {
        const [control] = await args[1]!.tx!.$queryRaw<{ paused: boolean }[]>`
          SELECT paused FROM core.fixture_import_control WHERE id = 1`
        businessWriteObserved = control?.paused === true
        throw new Error('INJECTED_STRICT_AUDIT_FAILURE')
      }
      return record(...args)
    })
    try {
      await expect(service.executeDurable(principal, input, 1, adapter)).rejects.toThrow(
        'INJECTED_STRICT_AUDIT_FAILURE'
      )
    } finally {
      injected.mockRestore()
    }
    expect(businessWriteObserved).toBe(true)
    expect((await adapter.readSummary()).paused).toBe(false)
    const receipt = await service.executeDurable(principal, input, 1, adapter)
    expect(receipt.state).toBe('requested')
    expect((await adapter.readSummary()).paused).toBe(false)
  })

  it('replays a persisted unknown command without observing or dispatching the broker again', async () => {
    const input = command()
    let observations = 0
    let dispatches = 0
    const port = {
      observe: async () => {
        observations += 1
        return [
          {
            id: 'image',
            queueEpoch: uuidv7(),
            snapshot: { revision, controlRevision: 0, paused: false },
          },
        ]
      },
      dispatch: async () => {
        dispatches += 1
        throw new Error('Injected lost transport acknowledgement')
      },
    }
    const commands = module.get(BackgroundCommandService)
    const first = await commands.execute(principal, input, 1, port)
    expect(first.targets[0]?.state).toBe('unknown')
    const replay = await commands.execute(principal, input, 1, port)
    expect(replay).toEqual(first)
    expect({ observations, dispatches }).toEqual({ observations: 1, dispatches: 1 })
    expect(
      (await prisma.backgroundWorkControl.findUniqueOrThrow({ where: { workId: 'image' } }))
        .desiredSequence
    ).toBe(1n)
  })

  it('quarantines job ADMIN commands behind an unresolved work-level pause', async () => {
    const commands = module.get(BackgroundCommandService)
    const input = command()
    await commands.execute(principal, input, 1, {
      observe: async () => [
        {
          id: 'image',
          queueEpoch: uuidv7(),
          snapshot: { revision, controlRevision: 0, paused: false },
        },
      ],
      dispatch: async () => ({ state: 'unknown' }),
    })
    const incarnation = uuidv7()
    const retry: WorkCommand = {
      ...command(),
      operation: 'retry',
      targets: [{ id: 'job', incarnation, revision }],
    }
    const dispatch = jest.fn<() => Promise<never>>(async () => {
      throw new Error('UNEXPECTED_DISPATCH')
    })
    await expect(
      commands.execute(principal, retry, 1, {
        observe: async () => [{ id: 'job', incarnation, snapshot: { revision } }],
        dispatch,
      })
    ).rejects.toMatchObject({ errorCode: 'COMMAND_CONFLICT' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(await prisma.backgroundCommand.count()).toBe(1)
  })

  it('rejects expired new IDs before broker reads but retains old authorized receipts/replays', async () => {
    const commands = module.get(BackgroundCommandService)
    const observe = jest.fn<() => Promise<never>>(async () => {
      throw new Error('UNEXPECTED_OBSERVATION')
    })
    const old = { ...command(), commandId: uuidv7({ msecs: Date.now() - 86401000 }) }
    await expect(
      commands.execute(principal, old, 1, {
        observe,
        dispatch: async () => {
          throw new Error('UNEXPECTED_DISPATCH')
        },
      })
    ).rejects.toMatchObject({ errorCode: 'COMMAND_EXPIRED' })
    expect(observe).not.toHaveBeenCalled()
    const input = command()
    await commands.execute(principal, input, 1, {
      observe: async () => [
        {
          id: 'image',
          queueEpoch: uuidv7(),
          snapshot: { revision, controlRevision: 0, paused: false },
        },
      ],
      dispatch: async () => ({ state: 'unknown' }),
    })
    // Age does not gate receipt GET. Replay age is tested by persisted identity
    // rather than changing DB authority/time or manufacturing a second dispatch.
    expect((await commands.receipt(principal, input.commandId)).targets[0]?.state).toBe('unknown')
  })

  it('suppresses repeated denied audits in a finite actor slot without creating arbitrary work rows', async () => {
    // Use the real domain exception so the strict denial method records its safe code.
    const { backgroundControlError } = await import('../src/core/admin/background-control-error')
    for (let n = 0; n < 3; n++)
      await admission.recordDenied(
        principal,
        { ...command(), workId: `unknown-${n}` },
        1,
        backgroundControlError('WORK_UNAVAILABLE')
      )
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_denied' },
      })
    ).toBe(1)
    expect(
      await prisma.backgroundBudget.findMany({ where: { key: { startsWith: 'work:' } } })
    ).toHaveLength(0)
  })

  it('reserves monotonically increasing queue sequences even when broker revision has not advanced', async () => {
    const commands = module.get(BackgroundCommandService)
    const nextRevisions: number[] = []
    const port = {
      observe: async () => [
        {
          id: 'image',
          queueEpoch: uuidv7(),
          snapshot: { revision, controlRevision: 0, paused: false },
        },
      ],
      dispatch: async (target: { snapshot: unknown }) => {
        nextRevisions.push((target.snapshot as { nextRevision: number }).nextRevision)
        return { state: 'rejected' as const, reason: 'STATE_CHANGED' as const }
      },
    }
    await commands.execute(principal, command(), 1, port)
    await commands.execute(principal, command(), 1, port)
    expect(nextRevisions).toEqual([1, 2])
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_intent' },
      })
    ).toBe(2)
  })

  it('persists intent, reservation and strict audit; replay does not reserve again', async () => {
    const input = command()
    const first = await prepare(input)
    expect('denied' in first).toBe(false)
    const replay = await prepare(input)
    expect('replay' in replay && replay.replay).toBe(true)
    expect(await prisma.backgroundCommand.count()).toBe(1)
    const budget = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    expect(budget).toMatchObject({
      commands: 1,
      targets: 1,
      activeCommands: 1,
      activeTargets: 1,
      unknownTargets: 1,
    })
    expect(
      await prisma.auditLog.count({
        where: { action: 'background_work.command_intent', actorId: principal.sub },
      })
    ).toBe(1)
  })

  it('commits denied audit/request accounting but rolls back target reservations on a conflict', async () => {
    await prepare(command())
    const denied = await prepare(command())
    expect('denied' in denied && denied.denied.errorCode).toBe('COMMAND_CONFLICT')
    const budget = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    expect(budget.targets).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { action: 'background_work.command_denied', actorId: principal.sub },
      })
    ).toBe(1)
  })

  it('serializes two dispatch claims and never redispatches an unknown command', async () => {
    const input = command()
    await prepare(input)
    const begin = () =>
      transaction(module.get(PrismaService), (ctx) =>
        settlement.beginDispatch(ctx, principal, input.commandId, 'image')
      )
    const claims = await Promise.all([begin(), begin()])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    await transaction(module.get(PrismaService), (ctx) =>
      settlement.finalize(ctx, principal.sub, input.commandId, 'image', claim.dispatchId!, {
        state: 'unknown',
      })
    )
    expect(await begin()).toBeNull()
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).unknownTargets
    ).toBe(1)
  })

  it('finalizes a known late outcome once, retaining the unknown history in audit', async () => {
    const input = command()
    await prepare(input)
    const claim = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, input.commandId, 'image')
    )
    const finalize = (state: 'unknown' | 'applied') =>
      transaction(module.get(PrismaService), (ctx) =>
        settlement.finalize(ctx, principal.sub, input.commandId, 'image', claim!.dispatchId!, {
          state,
        })
      )
    await finalize('unknown')
    await finalize('applied')
    await finalize('applied')
    const budget = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    expect(budget).toMatchObject({ activeCommands: 0, activeTargets: 0, unknownTargets: 0 })
    expect(
      await prisma.auditLog.count({
        where: { action: 'background_work.command_outcome', actorId: principal.sub },
      })
    ).toBe(3)
  })

  it('expires undispatched preparation without a broker call and releases reservations once', async () => {
    const input = command()
    await prepare(input)
    await prisma.backgroundCommand.update({
      where: {
        actorId_commandId: {
          actorId: principal.sub,
          commandId: input.commandId,
        },
      },
      data: { dispatchUntil: new Date(Date.now() - 1000) },
    })
    await module.get(BackgroundControlMaintenance).tick()
    await module.get(BackgroundControlMaintenance).tick()
    const target = await prisma.backgroundCommandTarget.findFirstOrThrow({
      where: { commandId: input.commandId },
    })
    expect(target).toMatchObject({
      state: 'not_attempted',
      reason: 'COMMAND_EXPIRED',
      dispatchId: null,
    })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 0, activeTargets: 0, unknownTargets: 0 })
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_outcome' },
      })
    ).toBe(1)
  })

  it('expires an ambiguous dispatch into retained unknown and never grants redispatch', async () => {
    const input = command()
    await prepare(input)
    const claimed = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, input.commandId, 'image')
    )
    await prisma.backgroundCommandTarget.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: new Date(Date.now() - 1000) },
    })
    await module.get(BackgroundControlMaintenance).tick()
    expect(
      await prisma.backgroundCommandTarget.findFirstOrThrow({
        where: { commandId: input.commandId },
      })
    ).toMatchObject({ state: 'unknown', dispatchId: claimed!.dispatchId, finalizedAt: null })
    expect(
      await transaction(module.get(PrismaService), (ctx) =>
        settlement.beginDispatch(ctx, principal, input.commandId, 'image')
      )
    ).toBeNull()
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 1, activeTargets: 1, unknownTargets: 1 })
  })

  it('keeps expiration and reservations unchanged when strict outcome audit fails', async () => {
    const input = command()
    await prepare(input)
    await prisma.backgroundCommand.update({
      where: {
        actorId_commandId: {
          actorId: principal.sub,
          commandId: input.commandId,
        },
      },
      data: { dispatchUntil: new Date(Date.now() - 1000) },
    })
    const audit = jest
      .spyOn(module.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('Injected audit outage'))
    await module.get(BackgroundControlMaintenance).tick()
    audit.mockRestore()
    expect(
      await prisma.backgroundCommandTarget.findFirstOrThrow({
        where: { commandId: input.commandId },
      })
    ).toMatchObject({ state: 'prepared' })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 1, activeTargets: 1, unknownTargets: 1 })
    await module.get(BackgroundControlMaintenance).tick()
    expect(
      await prisma.backgroundCommandTarget.findFirstOrThrow({
        where: { commandId: input.commandId },
      })
    ).toMatchObject({ state: 'not_attempted' })
  })

  it('purges only safely finalized old receipts, preserving strict audit and protected unknown capacity', async () => {
    const known = command()
    await prepare(known)
    const claim = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, known.commandId, 'image')
    )
    await transaction(module.get(PrismaService), (ctx) =>
      settlement.finalize(ctx, principal.sub, known.commandId, 'image', claim!.dispatchId!, {
        state: 'applied',
      })
    )
    await prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    const unknown = command()
    await prepare(unknown)
    const ambiguous = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, unknown.commandId, 'image')
    )
    await transaction(module.get(PrismaService), (ctx) =>
      settlement.finalize(ctx, principal.sub, unknown.commandId, 'image', ambiguous!.dispatchId!, {
        state: 'unknown',
      })
    )
    const old = new Date(Date.now() - 31 * 86400000)
    await prisma.backgroundCommand.updateMany({
      where: { commandId: known.commandId },
      data: { finalizedAt: old },
    })
    await prisma.backgroundCommandTarget.updateMany({
      where: { commandId: known.commandId },
      data: { finalizedAt: old },
    })
    // Even a deliberately populated old finalization timestamp must not permit unknown deletion.
    await prisma.backgroundCommand.updateMany({
      where: { commandId: unknown.commandId },
      data: { finalizedAt: old },
    })
    await module.get(BackgroundControlMaintenance).tick()
    await module.get(BackgroundControlMaintenance).tick()
    expect(await prisma.backgroundCommand.count({ where: { commandId: known.commandId } })).toBe(0)
    expect(
      await prisma.backgroundCommandTarget.count({ where: { commandId: unknown.commandId } })
    ).toBe(1)
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({
      commands: 1,
      targets: 1,
      activeCommands: 1,
      activeTargets: 1,
      unknownTargets: 1,
    })
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_intent' },
      })
    ).toBe(2)
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_outcome' },
      })
    ).toBe(4)
  })

  it('compacts an old ADMIN unknown without refunding slots or permitting command redispatch', async () => {
    const recovery = await unknownReceipt()
    const old = new Date(Date.now() - 31 * 86400000)
    await prisma.backgroundCommand.updateMany({
      where: { commandId: recovery.input.commandId },
      data: { createdAt: old },
    })
    const before = await prisma.backgroundCommandTarget.findFirstOrThrow({
      where: { commandId: recovery.input.commandId },
    })
    const initial = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    await module.get(BackgroundControlMaintenance).tick()
    const compact = await prisma.backgroundCommandTarget.findFirstOrThrow({
      where: { commandId: recovery.input.commandId },
    })
    expect(compact).toMatchObject({
      state: 'unknown',
      resolution: 'none',
      logicalBytes: 512,
      dispatchId: before.dispatchId,
      dispatchAfter: before.dispatchAfter,
      dispatchUntil: before.dispatchUntil,
      incarnation: before.incarnation,
      queueEpoch: before.queueEpoch,
    })
    expect(compact.snapshot).toMatchObject({
      snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const parent = await prisma.backgroundCommand.findFirstOrThrow({
      where: { commandId: recovery.input.commandId },
    })
    expect(parent.reason).toBe('')
    const budget = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    expect(budget).toMatchObject({
      commands: 1,
      targets: 1,
      activeCommands: 1,
      activeTargets: 1,
      unknownTargets: 1,
    })
    expect(budget.logicalBytes).toBe(
      initial.logicalBytes -
        BigInt(before.logicalBytes - 512) -
        BigInt(Buffer.byteLength(JSON.stringify(recovery.input.reason)) - 2)
    )
    await module.get(BackgroundControlMaintenance).tick()
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).logicalBytes
    ).toBe(budget.logicalBytes)
    await prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    const port = {
      observe: jest.fn<() => Promise<never>>(),
      dispatch: jest.fn<() => Promise<never>>(),
    }
    const service = module.get(BackgroundCommandService)
    expect((await service.execute(principal, recovery.input, 1, port)).targets[0]?.state).toBe(
      'unknown'
    )
    expect(port.observe).not.toHaveBeenCalled()
    expect(port.dispatch).not.toHaveBeenCalled()
    const acknowledged = await service.reconcile(
      principal,
      recovery.input.commandId,
      {
        revision: parent.revision,
        disposition: recovery.disposition,
        reason: recovery.reason,
        references: recovery.references,
      },
      async () => undefined
    )
    expect(acknowledged.targets[0]).toMatchObject({
      state: 'unknown',
      resolution: 'acknowledged_unknown',
    })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({
      activeCommands: 0,
      activeTargets: 0,
      unknownTargets: 1,
      logicalBytes: budget.logicalBytes,
    })
  })

  it('removes only idle zero-reservation actor budgets and refunds their finite cardinality', async () => {
    const old = new Date(Date.now() - 31 * 86400000)
    await transaction(module.get(PrismaService), (ctx) =>
      module.get(BackgroundControlBudgets).lock(ctx, principal.sub, 'image')
    )
    await prisma.backgroundBudget.updateMany({
      where: { key: { startsWith: 'actor' } },
      data: { updatedAt: old, lastObservedTime: old },
    })
    const actorWork = `actor-work:${principal.sub}:image`
    await prisma.backgroundBudget.update({
      where: { key: actorWork },
      data: { unknownTargets: 1, updatedAt: old },
    })
    await module.get(BackgroundControlMaintenance).tick()
    expect(
      await prisma.backgroundBudget.findUnique({ where: { key: `actor:${principal.sub}` } })
    ).toBeNull()
    expect(await prisma.backgroundBudget.findUnique({ where: { key: actorWork } })).not.toBeNull()
    expect(
      await prisma.backgroundBudget.findUnique({ where: { key: 'work:image' } })
    ).not.toBeNull()
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ actorBudgetRows: 1 })
  })

  async function unknownReceipt() {
    const input = command()
    await prepare(input)
    const claim = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, input.commandId, 'image')
    )
    await transaction(module.get(PrismaService), (ctx) =>
      settlement.finalize(ctx, principal.sub, input.commandId, 'image', claim!.dispatchId!, {
        state: 'unknown',
      })
    )
    const expired = new Date(Date.now() - 10_000)
    await prisma.backgroundCommand.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    await prisma.backgroundCommandTarget.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    const stored = await prisma.backgroundCommand.findFirstOrThrow({
      where: { commandId: input.commandId },
    })
    return {
      input,
      revision: stored.revision,
      disposition: 'acknowledged_unknown' as const,
      reason: 'Inspected worker logs; duplicate risk accepted',
      references: ['incident_42'],
    }
  }

  it('records a separate unknown disposition, releases execution slots and retains replay/unknown capacity', async () => {
    const recovery = await unknownReceipt()
    const service = module.get(BackgroundCommandService)
    // PG authority proof: actual Redis TIME/PING is covered separately at the HTTP integration boundary.
    const barrier = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const result = await service.reconcile(
      principal,
      recovery.input.commandId,
      {
        revision: recovery.revision,
        disposition: recovery.disposition,
        reason: recovery.reason,
        references: recovery.references,
      },
      barrier
    )
    expect(barrier).toHaveBeenCalledTimes(1)
    expect(result.targets[0]).toMatchObject({
      state: 'unknown',
      resolution: 'acknowledged_unknown',
    })
    expect(result.unknownCount).toBe(1)
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 0, activeTargets: 0, unknownTargets: 1 })
    await prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    const port = {
      observe: jest.fn<() => Promise<never>>(),
      dispatch: jest.fn<() => Promise<never>>(),
    }
    expect((await service.execute(principal, recovery.input, 1, port)).targets[0]?.state).toBe(
      'unknown'
    )
    expect(port.observe).not.toHaveBeenCalled()
    expect(port.dispatch).not.toHaveBeenCalled()
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.command_resolution' },
      })
    ).toBe(1)
  })

  it('rolls back disposition and slot release if strict resolution audit fails', async () => {
    const recovery = await unknownReceipt()
    const audit = jest
      .spyOn(module.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('Injected resolution audit outage'))
    try {
      await expect(
        module.get(BackgroundCommandService).reconcile(
          principal,
          recovery.input.commandId,
          {
            revision: recovery.revision,
            disposition: recovery.disposition,
            reason: recovery.reason,
            references: recovery.references,
          },
          async () => undefined
        )
      ).rejects.toThrow('Injected resolution audit outage')
    } finally {
      audit.mockRestore()
    }
    expect(
      await prisma.backgroundCommandTarget.findFirstOrThrow({
        where: { commandId: recovery.input.commandId },
      })
    ).toMatchObject({ state: 'unknown', resolution: 'none' })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 1, activeTargets: 1, unknownTargets: 1 })
  })

  function providerInput(automaticLimit = 3): ProviderAdmission {
    return {
      workId: 'email',
      jobId: 'email-job',
      incarnation: uuidv7(),
      queueEpoch: uuidv7(),
      jobName: 'send-email',
      wireVersion: 1,
      policyVersion: 1,
      automaticLimit,
      requestDigest: 'a'.repeat(64),
      providerScope: 'b'.repeat(64),
    }
  }
  async function attempt(input: ProviderAdmission): Promise<ProviderAttempt> {
    const reserved = await evidence.reserve(input)
    if ('accepted' in reserved) throw new Error('Expected possible-call reservation')
    return reserved
  }
  function witness(reserved: ProviderAttempt) {
    // This suite proves PG authority; the real broker witness/transport interaction is a separate gate.
    return {
      kind: 'reported' as const,
      attemptId: reserved.attemptId,
      incarnation: reserved.row.incarnation,
      brokerRevision: 1,
    }
  }

  it('expires definitive provider evidence independently while retaining unknown and command-fenced rows', async () => {
    const accepted = await attempt(providerInput())
    const unknown = await attempt(providerInput())
    const fenced = await attempt(providerInput())
    await evidence.finalize(
      accepted,
      { code: 'COMPLETED', certainty: 'accepted' },
      witness(accepted)
    )
    await evidence.finalize(
      unknown,
      { code: 'TRANSIENT_FAILURE', certainty: 'unknown' },
      witness(unknown)
    )
    await evidence.finalize(fenced, { code: 'COMPLETED', certainty: 'accepted' }, witness(fenced))
    const old = new Date(Date.now() - 31 * 86400000)
    await prisma.backgroundEffectEvidence.updateMany({ data: { finalizedAt: old } })
    await prisma.backgroundEffectEvidence.update({
      where: {
        workId_incarnation: {
          workId: fenced.row.workId,
          incarnation: fenced.row.incarnation,
        },
      },
      data: { commandFence: uuidv7() },
    })
    await module.get(BackgroundControlMaintenance).tick()
    await module.get(BackgroundControlMaintenance).tick()
    expect(await prisma.backgroundEffectEvidence.count()).toBe(2)
    expect(
      await prisma.backgroundEffectEvidence.findUnique({
        where: {
          workId_incarnation: {
            workId: accepted.row.workId,
            incarnation: accepted.row.incarnation,
          },
        },
      })
    ).toBeNull()
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ evidenceRows: 2, evidenceBytes: 4096n, unresolvedRows: 1 })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'work:email' } })
    ).toMatchObject({ evidenceRows: 2, evidenceBytes: 4096n, unresolvedRows: 1 })
    expect(await prisma.backgroundCommand.count()).toBe(0)
  })

  it('protects automatic provider uncertainty without creating an ADMIN intent', async () => {
    const input = providerInput()
    const reserved = await attempt(input)
    expect(await prisma.backgroundCommand.count()).toBe(0)
    expect((await evidence.read(input.workId, input.incarnation))!).toMatchObject({
      certainty: 'unknown',
      outcomeRecorded: false,
      autoStartsUsed: 1,
      unresolvedCount: 1,
    })
    await expect(evidence.reserve(input)).rejects.toThrow('OUTCOME_UNRECORDED')
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).unresolvedRows
    ).toBe(1)
    await evidence.finalize(
      reserved,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(reserved)
    )
    expect((await evidence.read(input.workId, input.incarnation))!.outcomeRecorded).toBe(true)
  })

  it('audits provider uncertainty disposition without an ADMIN command or refunds/new effect authority', async () => {
    const reserved = await attempt(providerInput())
    await evidence.finalize(
      reserved,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(reserved)
    )
    const before = await evidence.read(reserved.row.workId, reserved.row.incarnation)
    await module.get(BackgroundCommandService).reconcileEvidence(
      principal,
      before!.workId,
      before!.jobId,
      {
        revision: before!.revision,
        incarnation: before!.incarnation,
        disposition: 'acknowledged_unknown',
        reason: 'Inspected provider logs; uncertainty retained',
        references: ['incident_42'],
      },
      evidence
    )
    expect(await evidence.read(before!.workId, before!.incarnation)).toMatchObject({
      revision: before!.revision + 1,
      disposition: 'acknowledged_unknown',
      certainty: 'unknown',
      unresolvedCount: before!.unresolvedCount,
      autoStartsUsed: before!.autoStartsUsed,
      manualGrant: before!.manualGrant,
      commandFence: before!.commandFence,
      requestDigest: before!.requestDigest,
      providerScope: before!.providerScope,
    })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ evidenceRows: 1, evidenceBytes: 2048n, unresolvedRows: 1, commands: 0 })
    expect(await prisma.backgroundCommand.count()).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { actorId: principal.sub, action: 'background_work.evidence_resolution' },
      })
    ).toBe(1)
  })

  it('refuses disposition of an active/unrecorded attempt without disrupting its eventual finalization', async () => {
    const reserved = await attempt(providerInput())
    await expect(
      module.get(BackgroundCommandService).reconcileEvidence(
        principal,
        reserved.row.workId,
        reserved.row.jobId,
        {
          revision: reserved.row.revision,
          incarnation: reserved.row.incarnation,
          disposition: 'acknowledged_unknown',
          reason: 'Inspecting an unfinished call',
          references: [],
        },
        evidence
      )
    ).rejects.toMatchObject({ errorCode: 'OUTCOME_UNRECORDED' })
    expect(await evidence.read(reserved.row.workId, reserved.row.incarnation)).toMatchObject({
      revision: reserved.row.revision,
      activeAttemptId: reserved.attemptId,
      disposition: 'none',
      outcomeRecorded: false,
    })
    await evidence.finalize(
      reserved,
      { certainty: 'accepted', code: 'COMPLETED' },
      witness(reserved)
    )
    expect(await evidence.read(reserved.row.workId, reserved.row.incarnation)).toMatchObject({
      certainty: 'accepted',
      outcomeRecorded: true,
    })
  })

  it('rolls back provider disposition when its strict independent audit fails', async () => {
    const reserved = await attempt(providerInput())
    await evidence.finalize(
      reserved,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(reserved)
    )
    const before = await evidence.read(reserved.row.workId, reserved.row.incarnation)
    const audit = jest
      .spyOn(module.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('Injected evidence audit outage'))
    try {
      await expect(
        module.get(BackgroundCommandService).reconcileEvidence(
          principal,
          before!.workId,
          before!.jobId,
          {
            revision: before!.revision,
            incarnation: before!.incarnation,
            disposition: 'acknowledged_unknown',
            reason: 'Inspected provider records',
            references: [],
          },
          evidence
        )
      ).rejects.toThrow('Injected evidence audit outage')
    } finally {
      audit.mockRestore()
    }
    expect(await evidence.read(before!.workId, before!.incarnation)).toMatchObject({
      revision: before!.revision,
      disposition: 'none',
      certainty: 'unknown',
    })
  })

  it('permits irreducible unrecorded disposition only beyond the immutable horizon plus both timestamp bounds', async () => {
    const reserved = await attempt(providerInput())
    const deadline = reserved.row.nominalDeadline!.getTime()
    for (const delta of [3999, 4000])
      expect(evidence.dispositionReason(reserved.row, deadline + delta)).toBe('OUTCOME_UNRECORDED')
    expect(evidence.dispositionReason(reserved.row, deadline + 4001)).toBeUndefined()
    const oldDeadline = new Date(Date.now() - 10000)
    await prisma.backgroundEffectEvidence.update({
      where: {
        workId_incarnation: {
          workId: reserved.row.workId,
          incarnation: reserved.row.incarnation,
        },
      },
      data: {
        nominalDeadline: oldDeadline,
        firstDispatchAt: new Date(oldDeadline.getTime() - 86400000),
      },
    })
    await module.get(BackgroundCommandService).reconcileEvidence(
      principal,
      reserved.row.workId,
      reserved.row.jobId,
      {
        revision: reserved.row.revision,
        incarnation: reserved.row.incarnation,
        disposition: 'acknowledged_unknown',
        reason: 'Immutable horizon closed; uncertainty retained',
        references: ['incident_42'],
      },
      evidence
    )
    expect(await evidence.read(reserved.row.workId, reserved.row.incarnation)).toMatchObject({
      activeAttemptId: reserved.attemptId,
      outcomeRecorded: false,
      certainty: 'unknown',
      unresolvedCount: 1,
      autoStartsUsed: 1,
      manualGrant: 'none',
      disposition: 'acknowledged_unknown',
    })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ evidenceRows: 1, evidenceBytes: 2048n, unresolvedRows: 1 })
  })

  it('compacts old protected provider uncertainty once without losing attempt clocks, identity or capacity', async () => {
    const reserved = await attempt(providerInput())
    const old = new Date(Date.now() - 31 * 86400000)
    await prisma.backgroundEffectEvidence.update({
      where: {
        workId_incarnation: {
          workId: reserved.row.workId,
          incarnation: reserved.row.incarnation,
        },
      },
      data: { createdAt: old },
    })
    const before = await evidence.read(reserved.row.workId, reserved.row.incarnation)
    await transaction(module.get(PrismaService), (ctx) =>
      evidence.compactUnknown(ctx, reserved.row.workId, reserved.row.incarnation)
    )
    const after = await evidence.read(reserved.row.workId, reserved.row.incarnation)
    expect(after).toEqual({ ...before, logicalBytes: 512, updatedAt: after!.updatedAt })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ evidenceRows: 1, evidenceBytes: 512n, unresolvedRows: 1 })
    expect(
      await transaction(module.get(PrismaService), (ctx) =>
        evidence.compactUnknown(ctx, reserved.row.workId, reserved.row.incarnation)
      )
    ).toBe(false)
    await evidence.finalize(
      reserved,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(reserved)
    )
    expect(await evidence.read(reserved.row.workId, reserved.row.incarnation)).toMatchObject({
      logicalBytes: 512,
      certainty: 'unknown',
      unresolvedCount: 1,
      outcomeRecorded: true,
      activeAttemptId: null,
      autoStartsUsed: 1,
      requestDigest: reserved.row.requestDigest,
      providerScope: reserved.row.providerScope,
      nominalDeadline: reserved.row.nominalDeadline,
    })
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ evidenceRows: 1, evidenceBytes: 512n, unresolvedRows: 1 })
  })

  it('settles an unknown provider cancel fence after command acknowledgement without creating a retry grant', async () => {
    const identity = providerInput(1)
    const input: WorkCommand = {
      ...command(),
      workId: identity.workId,
      operation: 'cancel',
      targets: [
        { id: identity.jobId, incarnation: identity.incarnation, revision: 'b'.repeat(64) },
      ],
    }
    await transaction(module.get(PrismaService), async (ctx) => {
      await module.get(BackgroundControlBudgets).lock(ctx, principal.sub, identity.workId)
      const row = await evidence.reserveControl(
        ctx,
        {
          workId: identity.workId,
          jobId: identity.jobId,
          incarnation: identity.incarnation,
          queueEpoch: identity.queueEpoch,
          jobName: identity.jobName,
          wireVersion: identity.wireVersion,
          policyVersion: identity.policyVersion,
          automaticLimit: identity.automaticLimit,
          evidenceRevision: null,
        },
        'cancel',
        input.commandId
      )
      return admission.prepare(ctx, principal, input, 1, [
        {
          id: identity.jobId,
          incarnation: identity.incarnation,
          queueEpoch: identity.queueEpoch,
          snapshot: { revision: 'b'.repeat(64), providerRevision: row.revision },
        },
      ])
    })
    const claim = await transaction(module.get(PrismaService), (ctx) =>
      settlement.beginDispatch(ctx, principal, input.commandId, identity.jobId)
    )
    await transaction(module.get(PrismaService), (ctx) =>
      settlement.finalize(ctx, principal.sub, input.commandId, identity.jobId, claim!.dispatchId!, {
        state: 'unknown',
      })
    )
    const expired = new Date(Date.now() - 10000)
    await prisma.backgroundCommand.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    await prisma.backgroundCommandTarget.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    const receipt = await prisma.backgroundCommand.findFirstOrThrow({
      where: { commandId: input.commandId },
    })
    await module.get(BackgroundCommandService).reconcile(
      principal,
      input.commandId,
      {
        revision: receipt.revision,
        disposition: 'acknowledged_unknown',
        reason: 'Inspected command uncertainty',
        references: [],
      },
      async () => undefined
    ) // PG interaction proof; actual Redis barrier has a separate HTTP gate.
    expect(await evidence.read(identity.workId, identity.incarnation)).toMatchObject({
      commandFence: null,
      manualGrant: 'none',
      certainty: 'none',
      autoStartsUsed: 0,
    })
    const possible = await evidence.reserve(identity)
    expect('accepted' in possible).toBe(false)
    expect(
      await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    ).toMatchObject({ activeCommands: 0, activeTargets: 0, unknownTargets: 1, unresolvedRows: 1 })
  })

  it('fences an unstarted provider job until a definitive control refusal, then freezes its first request', async () => {
    const input = providerInput()
    const { requestDigest: _digest, providerScope: _scope, ...identity } = input
    const commandId = uuidv7()
    const control = await transaction(prisma as never, (ctx) =>
      evidence.reserveControl(ctx, { ...identity, evidenceRevision: null }, 'cancel', commandId)
    )
    await expect(evidence.reserve(input)).rejects.toThrow('COMMAND_CONFLICT')
    await transaction(prisma as never, (ctx) =>
      evidence.settleControl(
        ctx,
        input.workId,
        input.incarnation,
        commandId,
        control.revision,
        'cancel',
        'unknown'
      )
    )
    await expect(evidence.reserve(input)).rejects.toThrow('COMMAND_CONFLICT')
    await transaction(prisma as never, (ctx) =>
      evidence.settleControl(
        ctx,
        input.workId,
        input.incarnation,
        commandId,
        control.revision,
        'cancel',
        'rejected'
      )
    )
    const first = await attempt(input)
    expect(first.row).toMatchObject({
      autoStartsUsed: 1,
      requestDigest: input.requestDigest,
      providerScope: input.providerScope,
      commandFence: null,
    })
    expect(first.row.firstDispatchAt).not.toBeNull()
  })

  it('consumes a provider manual grant only after its ADMIN receipt commits, retaining immutable clocks and identity', async () => {
    const input = providerInput()
    const first = await attempt(input)
    await evidence.finalize(first, { certainty: 'none', code: 'RATE_LIMITED' }, witness(first))
    const row = (await evidence.read(input.workId, input.incarnation))!
    const { requestDigest: _digest, providerScope: _scope, ...identity } = input
    const commandId = uuidv7()
    const control = await transaction(prisma as never, (ctx) =>
      evidence.reserveControl(
        ctx,
        { ...identity, evidenceRevision: row.revision },
        'retry',
        commandId
      )
    )
    await expect(evidence.reserve({ ...input, manualCommandId: commandId })).rejects.toThrow(
      'COMMAND_CONFLICT'
    )
    const prepared = await admission.admit(
      principal,
      {
        ...command(),
        commandId,
        workId: input.workId,
        operation: 'retry',
        targets: [{ id: input.jobId, incarnation: input.incarnation, revision }],
      },
      1,
      [
        {
          id: input.jobId,
          incarnation: input.incarnation,
          snapshot: {
            revision,
            providerRevision: control.revision,
          },
        },
      ]
    )
    if ('denied' in prepared) throw prepared.denied
    const dispatch = await transaction(prisma as never, (ctx) =>
      settlement.beginDispatch(ctx, principal, commandId, input.jobId)
    )
    await transaction(prisma as never, (ctx) =>
      settlement.finalize(ctx, principal.sub, commandId, input.jobId, dispatch!.dispatchId!, {
        state: 'applied',
      })
    )
    const manual = await attempt({ ...input, manualCommandId: commandId })
    expect(manual.mode).toBe('manual')
    expect(manual.row).toMatchObject({
      manualGrant: 'spent',
      autoStartsUsed: 1,
      requestDigest: input.requestDigest,
      providerScope: input.providerScope,
    })
    expect(manual.row.firstDispatchAt).toEqual(first.row.firstDispatchAt)
    expect(manual.row.nominalDeadline).toEqual(first.row.nominalDeadline)
    await evidence.finalize(manual, { certainty: 'accepted', code: 'COMPLETED' }, witness(manual))
    expect((await evidence.read(input.workId, input.incarnation))!.commandFence).toBeNull()
    expect(await evidence.reserve(input)).toEqual({ accepted: true })
  })

  it('never turns older unknown into none after a later verified rate-limit rejection', async () => {
    const input = providerInput()
    const first = await attempt(input)
    await evidence.finalize(
      first,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(first)
    )
    const second = await attempt(input)
    await evidence.finalize(second, { certainty: 'none', code: 'RATE_LIMITED' }, witness(second))
    expect((await evidence.read(input.workId, input.incarnation))!).toMatchObject({
      certainty: 'unknown',
      unresolvedCount: 1,
      autoStartsUsed: 2,
    })
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).unresolvedRows
    ).toBe(1)
  })

  it('authoritative same-key/body/scope acceptance clears unresolved quota and suppresses another call', async () => {
    const input = providerInput()
    const first = await attempt(input)
    await evidence.finalize(
      first,
      { certainty: 'unknown', code: 'TRANSIENT_FAILURE' },
      witness(first)
    )
    const second = await attempt(input)
    await evidence.finalize(second, { certainty: 'accepted', code: 'COMPLETED' }, witness(second))
    expect(await evidence.reserve(input)).toEqual({ accepted: true })
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).unresolvedRows
    ).toBe(0)
  })

  it('refences the same reservation without resetting horizon or spending another start', async () => {
    const input = providerInput()
    const first = await attempt(input)
    const refreshed = await evidence.refence(first)
    expect(refreshed.attemptId).toBe(first.attemptId)
    expect(refreshed.row.autoStartsUsed).toBe(1)
    expect(refreshed.row.firstDispatchAt).toEqual(first.row.firstDispatchAt)
    expect(refreshed.row.nominalDeadline).toEqual(first.row.nominalDeadline)
  })

  it('fails closed on frozen body/provider changes and exhausted finite starts', async () => {
    const input = providerInput(1)
    const first = await attempt(input)
    await evidence.finalize(first, { certainty: 'none', code: 'RATE_LIMITED' }, witness(first))
    await expect(evidence.reserve({ ...input, providerScope: 'c'.repeat(64) })).rejects.toThrow(
      'PROVIDER_CHANGED'
    )
    await expect(evidence.reserve({ ...input, requestDigest: 'c'.repeat(64) })).rejects.toThrow(
      'REQUEST_EXPIRED'
    )
    await expect(evidence.reserve(input)).rejects.toThrow('AUTOMATIC_BUDGET_SPENT')
    expect((await evidence.read(input.workId, input.incarnation))!.autoStartsUsed).toBe(1)
  })
})
