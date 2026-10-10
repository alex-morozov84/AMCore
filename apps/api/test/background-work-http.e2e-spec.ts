import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { jest } from '@jest/globals'
import type { WorkerHost } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import request from 'supertest'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import {
  workCatalogueSchema,
  type WorkCommand,
  workPageSchema,
  workReceiptSchema,
  type WorkSummary,
} from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import {
  importRegistration,
  importWork,
  ImportWorkAdapter,
} from '../recipes/background-work/db-owned-work'
import {
  imageRegistration,
  imageWork,
  ImageWorkHandler,
} from '../recipes/background-work/image-work'
import { BackgroundCommandService } from '../src/core/admin/background-command-service'
import { BackgroundCommandSettlement } from '../src/core/admin/background-command-settlement'
import { queueCommandPort } from '../src/core/admin/background-queue-command'
import { JwtStrategy } from '../src/core/auth/strategies/jwt.strategy'
import { ControlConnection } from '../src/infrastructure/background-work/control-connection'
import { CONTROL_LIMITS } from '../src/infrastructure/background-work/control-limits'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import { PgOutcomeBuffer } from '../src/infrastructure/background-work/pg-outcome-buffer'
import { ProviderEvidenceStore } from '../src/infrastructure/background-work/provider-evidence.store'
import {
  MANAGED_WORKERS,
  type ManagedWorkerBinding,
} from '../src/infrastructure/background-work/work-coordinator'
import { WorkFailure } from '../src/infrastructure/background-work/work-failure'
import type { EmailProvider } from '../src/infrastructure/email/email.types'
import { EmailTemplate } from '../src/infrastructure/email/email.types'
import { emailWork } from '../src/infrastructure/email/email.work'
import { QUEUE_REGISTRY } from '../src/infrastructure/queue/constants/queue-inventory.constant'
import { JobName } from '../src/infrastructure/queue/constants/queues.constant'

import {
  type E2ETestContext,
  setupE2ETest,
  signAccessToken,
  startWebAppContext,
  teardownE2ETest,
} from './helpers'

const base = '/api/v1/admin/background-work'

describe('One registration → shared privileged HTTP observation/control', () => {
  let context: E2ETestContext
  let token: string

  beforeAll(async () => {
    // Real production modules/guards/worker composition; only the registrations are fixtures.
    const { BACKGROUND_WORK } = await import('../src/background-work.composition')
    context = await setupE2ETest(undefined, {
      productionOrder: true,
      registrations: [...BACKGROUND_WORK, imageRegistration, importRegistration],
    })
    for (const name of ['db-owned-work', 'image-work']) {
      const sql = await readFile(
        resolve(import.meta.dirname, `../../../docs/backend/recipes/${name}.sql`),
        'utf8'
      )
      for (const statement of sql.split(';').filter((part) => part.trim()))
        await context.prisma.$executeRawUnsafe(statement)
    }
  }, 120000)

  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)

  it.each([512, 550])(
    'bounds the durable first-window API with %i business rows',
    async (count) => {
      token = await actor()
      await context.prisma.$executeRaw`TRUNCATE core.fixture_imports`
      await context.prisma.$executeRaw`
      INSERT INTO core.fixture_imports (id, incarnation, state)
      SELECT 'window-' || lpad(n::text, 4, '0'), ${uuidv4()}::uuid, 'failed'
      FROM generate_series(1, ${count}::integer) AS n`
      for (const limit of [50, 25]) {
        const lastPage = Math.ceil(512 / limit)
        for (const page of [1, lastPage]) {
          const response = await request(context.app.getHttpServer())
            .get(`${base}/works/fixture-import/jobs?state=failed&page=${page}&limit=${limit}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
          const result = workPageSchema.parse(response.body)
          expect(result.rows).toHaveLength(Math.min(limit, 512 - (page - 1) * limit))
          expect(result.windowTruncated).toBe(count > 512)
          expect(result.rows.every((row) => Number(row.identity.id.split('-')[1]) <= 512)).toBe(
            true
          )
          expect(result.rows.at(-1)?.identity.id).toBe(
            `window-${String(Math.min(page * limit, 512)).padStart(4, '0')}`
          )
        }
        await request(context.app.getHttpServer())
          .get(`${base}/works/fixture-import/jobs?state=failed&page=${lastPage + 1}&limit=${limit}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(400)
      }
    }
  )

  it('returns closed temporary unavailability when control connection capacity is exhausted', async () => {
    token = await actor()
    const previous = Reflect.get(ControlConnection, 'leases')
    Reflect.set(ControlConnection, 'leases', CONTROL_LIMITS.concurrentDispatches)
    try {
      const response = await request(context.app.getHttpServer())
        .get(`${base}/works/image/jobs?state=failed&page=1&limit=20`)
        .set('Authorization', `Bearer ${token}`)
        .expect(503)
      expect(response.body.errorCode).toBe('WORK_UNAVAILABLE')
      expect(JSON.stringify(response.body)).not.toContain('CONTROL_CONNECTION_LIMIT')
    } finally {
      Reflect.set(ControlConnection, 'leases', previous)
    }
  })

  beforeEach(async () => {
    // Separate scenarios share a stand, not their request clocks or anonymous flood buckets.
    // Retained intents, uncertainty, grants, storage and execution reservations are not reset.
    await context.prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    await context.throttlerStorage.reset()
  })

  async function actor() {
    const email = `conformance-${uuidv7()}@example.test`
    const user = await context.prisma.user.create({
      data: { emailCanonical: email, email, systemRole: 'SUPER_ADMIN' },
    })
    const session = await context.prisma.session.create({
      data: {
        userId: user.id,
        familyId: uuidv7(),
        refreshToken: uuidv7(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    return signAccessToken(context.app, {
      sub: user.id,
      sid: session.id,
      email,
      systemRole: 'SUPER_ADMIN',
    })
  }

  async function catalogue(): Promise<WorkSummary[]> {
    const response = await request(context.app.getHttpServer())
      .get(`${base}/works`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    return workCatalogueSchema.parse(response.body)
  }

  async function command(
    operation: WorkCommand['operation'],
    workId: string,
    targets: WorkCommand['targets'] = [],
    parameters: WorkCommand['parameters'] = {}
  ) {
    const current = (await catalogue()).find((row) => row.id === workId)!
    const response = await request(context.app.getHttpServer())
      .post(`${base}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        contractVersion: 1,
        commandId: uuidv7(),
        workId,
        operation,
        expectedWorkRevision: current.revision,
        targets,
        parameters,
        reason: 'Conformance maintenance',
      })
      .expect(200)
    return workReceiptSchema.parse(response.body)
  }

  it('discovers a new ordinary recipe, pauses claims, reads its safe job and cancels via the generic endpoint', async () => {
    token = await actor()
    expect((await catalogue()).some((row) => row.id === imageWork.id)).toBe(true)
    expect((await command('pause', imageWork.id)).state).toBe('applied')
    const producer = context.app.get<ManagedProducer<typeof imageWork>>(imageWork.tokens.producer)
    const added = await producer.add(
      'render',
      { businessRequestId: 'http-source', transformVersion: 1 },
      { jobId: 'http-image', attempts: 1 }
    )
    const response = await request(context.app.getHttpServer())
      .get(`${base}/works/image/jobs?state=waiting`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    const page = workPageSchema.parse(response.body)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]!.identity.incarnation).toBe(added.incarnation)
    expect(page.rows[0]!.projection).toEqual({
      businessRequestId: 'http-source',
      transformVersion: 1,
    })
    expect((await command('cancel', imageWork.id, [page.rows[0]!.identity])).state).toBe('applied')
    const queues = context.app.get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
    expect(await queues.get('image')!.getJob(added.jobId)).toBeUndefined()
    expect(await context.prisma.$queryRaw`SELECT * FROM core.image_fixture_outputs`).toEqual([])
  })

  it('discovers the DB-owned recipe and routes all five operations through shared API and strict audit', async () => {
    for (const operation of ['pause', 'resume', 'retry', 'cancel', 'cleanup'] as const) {
      token = await actor()
      let targets: WorkCommand['targets'] = []
      let parameters: WorkCommand['parameters'] = {}
      if (['retry', 'cancel', 'cleanup'].includes(operation)) {
        const state =
          operation === 'retry' ? 'failed' : operation === 'cancel' ? 'waiting' : 'completed'
        await context.prisma
          .$executeRaw`INSERT INTO core.fixture_imports (id, incarnation, state, finished)
          VALUES (${operation}, ${uuidv4()}::uuid, ${state},
            ${operation === 'cleanup' ? new Date(Date.now() - 2 * 86400000) : null})`
        const response = await request(context.app.getHttpServer())
          .get(`${base}/works/${importWork.id}/jobs?state=${state}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        targets = [
          workPageSchema.parse(response.body).rows.find((row) => row.identity.id === operation)!
            .identity,
        ]
        if (operation === 'cleanup')
          parameters = {
            states: ['completed'],
            cutoff: new Date(Date.now() - 86400000).toISOString(),
          }
      }
      expect((await command(operation, importWork.id, targets, parameters)).state).toBe('applied')
    }
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'background_work.command_intent', targetId: importWork.id },
      })
    ).toBe(5)
  })

  it('shares durable authority and request budgets across two APIs while broker control is unavailable', async () => {
    const { BACKGROUND_WORK } = await import('../src/background-work.composition')
    const secondary = await startWebAppContext({
      registrations: [...BACKGROUND_WORK, imageRegistration, importRegistration],
    })
    const apps = [context.app, secondary.app]
    const unavailable = apps.map((app) =>
      jest
        .spyOn(app.get(ControlConnection), 'withClient')
        .mockRejectedValue(new Error('BROKER_CONTROL_OFFLINE'))
    )
    try {
      token = await actor()
      const authorities = apps.map((app) => app.get(ImportWorkAdapter))
      const summaries = await Promise.all(authorities.map((adapter) => adapter.readSummary()))
      const input: WorkCommand = {
        contractVersion: 1,
        commandId: uuidv7(),
        workId: importWork.id,
        operation: 'pause',
        expectedWorkRevision: summaries[0]!.revision!,
        targets: [],
        parameters: {},
        reason: 'Two-replica durable conformance',
      }
      const send = (replica: number, body = input) =>
        request(apps[replica]!.getHttpServer())
          .post(`${replica === 0 ? base : '/admin/background-work'}/commands`)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
      const responses = await Promise.all([send(0), send(1)])
      expect(responses.map((response) => response.status)).toEqual([200, 200])
      expect(responses.map((response) => workReceiptSchema.parse(response.body).commandId)).toEqual(
        [input.commandId, input.commandId]
      )
      const receipts = await Promise.all(
        apps.map((app, replica) =>
          request(app.getHttpServer())
            .get(`${replica === 0 ? base : '/admin/background-work'}/commands/${input.commandId}`)
            .set('Authorization', `Bearer ${token}`)
        )
      )
      expect(receipts.map((response) => response.status)).toEqual([200, 200])
      expect(receipts.map((response) => workReceiptSchema.parse(response.body).state)).toEqual([
        'applied',
        'applied',
      ])
      expect(
        await context.prisma.auditLog.count({
          where: {
            action: 'background_work.command_intent',
            targetId: importWork.id,
            metadata: { path: ['commandId'], equals: input.commandId },
          },
        })
      ).toBe(1)
      const observed = await Promise.all(authorities.map((adapter) => adapter.readSummary()))
      expect(observed.map((summary) => summary.paused)).toEqual([true, true])
      expect(observed[0]!.revision).toBe(observed[1]!.revision)
      // Third request shares the actor's burst even when it is a retained replay.
      expect((await send(1)).status).toBe(200)
      expect((await send(0, { ...input, commandId: uuidv7() })).status).toBe(429)
      expect(unavailable.every((spy) => spy.mock.calls.length === 0)).toBe(true)
      const rowId = `replica-${uuidv7()}`
      await context.prisma.$executeRaw`INSERT INTO core.fixture_imports(id, incarnation, state)
        VALUES (${rowId}, ${uuidv7()}::uuid, 'waiting')`
      expect(await Promise.all(authorities.map((adapter) => adapter.claim()))).toEqual([null, null])
      await context.prisma
        .$executeRaw`UPDATE core.fixture_import_control SET paused = false, revision = revision + 1 WHERE id = 1`
      const claims = await Promise.all(authorities.map((adapter) => adapter.claim()))
      expect(claims.filter((claimed) => claimed?.id === rowId)).toHaveLength(1)
      expect(
        (
          await context.prisma.$queryRaw<
            { attempts: number }[]
          >`SELECT attempts FROM core.fixture_imports WHERE id = ${rowId}`
        )[0]!.attempts
      ).toBe(1)
    } finally {
      unavailable.forEach((spy) => spy.mockRestore())
      await secondary.app.close()
      // Passport registers strategies process-wide. The closed replica must not
      // keep owning subsequent requests in this single-process test harness.
      const passport = createRequire(import.meta.url)('passport') as {
        use(name: string, strategy: JwtStrategy): void
      }
      passport.use('jwt', context.app.get(JwtStrategy))
    }
  }, 60000)

  it('requires the original signed privileged claim as well as the current primary role', async () => {
    token = await actor()
    const decoded = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    const unprivileged = signAccessToken(context.app, {
      sub: decoded.sub,
      sid: decoded.sid,
      email: decoded.email,
      systemRole: 'USER',
    })
    await request(context.app.getHttpServer())
      .get(`${base}/works`)
      .set('Authorization', `Bearer ${unprivileged}`)
      .expect(403)
  })

  it('records a stale target refusal and applies the eligible target within one immutable batch', async () => {
    token = await actor()
    const producer = context.app.get<ManagedProducer<typeof imageWork>>(imageWork.tokens.producer)
    for (const id of ['partial-stale', 'partial-valid'])
      await producer.add(
        'render',
        {
          businessRequestId: id,
          transformVersion: 1,
        },
        { jobId: id, attempts: 1 }
      )
    const response = await request(context.app.getHttpServer())
      .get(`${base}/works/image/jobs?state=waiting`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    const rows = workPageSchema.parse(response.body).rows
    const stale = rows.find((row) => row.identity.id === 'partial-stale')!.identity
    const valid = rows.find((row) => row.identity.id === 'partial-valid')!.identity
    const result = await command('cancel', imageWork.id, [
      { ...stale, revision: '0'.repeat(64) },
      valid,
    ])
    expect(result.state).toBe('partial')
    expect(result.targets.map((target) => [target.id, target.state, target.reason])).toEqual([
      ['partial-stale', 'rejected', 'STATE_CHANGED'],
      ['partial-valid', 'applied', undefined],
    ])
    const queue = context.app.get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY).get('image')!
    expect(await queue.getJob(stale.id)).toBeDefined()
    expect(await queue.getJob(valid.id)).toBeUndefined()
  })

  it('cancels an unstarted queued email through shared policy admission and retains independent no-effect evidence', async () => {
    token = await actor()
    expect((await command('pause', emailWork.id)).state).toBe('applied')
    const producer = context.app.get<ManagedProducer<typeof emailWork>>(emailWork.tokens.producer)
    const identity = await producer.add(
      JobName.SEND_EMAIL,
      {
        template: EmailTemplate.WELCOME,
        to: 'fixture@example.test',
        data: { name: 'Fixture', email: 'fixture@example.test' },
      },
      { jobId: 'http-email', attempts: 1 }
    )
    const response = await request(context.app.getHttpServer())
      .get(`${base}/works/email/jobs?state=waiting`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    const job = workPageSchema
      .parse(response.body)
      .rows.find((row) => row.identity.id === identity.jobId)!
    expect(job.capabilities.find((item) => item.operation === 'cancel')?.allowed).toBe(true)
    expect((await command('cancel', emailWork.id, [job.identity])).state).toBe('applied')
    expect(
      await context.prisma.backgroundEffectEvidence.findUniqueOrThrow({
        where: { workId_incarnation: { workId: emailWork.id, incarnation: identity.incarnation } },
      })
    ).toMatchObject({
      certainty: 'none',
      outcomeRecorded: true,
      commandFence: null,
      autoStartsUsed: 0,
      firstDispatchAt: null,
    })
  })

  it('reads independent provider evidence with recycled IDs even when broker diagnostics are unavailable', async () => {
    token = await actor()
    const store = context.app.get(ProviderEvidenceStore)
    // Simulates a worker dying after durable possible-call reservation: absence cannot prove no effect.
    const id = 'recycled-evidence-job'
    const incarnations = [uuidv7(), uuidv7()]
    for (const incarnation of incarnations)
      await store.reserve({
        workId: emailWork.id,
        jobId: id,
        incarnation,
        queueEpoch: uuidv7(),
        jobName: JobName.SEND_EMAIL,
        wireVersion: 1,
        policyVersion: 1,
        automaticLimit: 1,
        requestDigest: 'a'.repeat(64),
        providerScope: 'b'.repeat(64),
      })
    const connection = jest
      .spyOn(context.app.get(ControlConnection), 'withClient')
      .mockRejectedValue(new Error('Injected broker outage'))
    try {
      const response = await request(context.app.getHttpServer())
        .get(`${base}/works/email/jobs?source=PG_evidence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const rows = workPageSchema.parse(response.body).rows.filter((row) => row.identity.id === id)
      expect(rows.map((row) => row.identity.incarnation).sort()).toEqual(incarnations.sort())
      for (const row of rows) {
        expect(row).toMatchObject({
          source: 'PG_evidence',
          state: 'unavailable',
          certainty: 'unknown',
          report: 'unrecorded',
        })
        expect(row.attemptsMade).toBeUndefined()
        expect(row.capabilities.every((item) => !item.allowed)).toBe(true)
        expect(JSON.stringify(row)).not.toContain('requestDigest')
        expect(JSON.stringify(row)).not.toContain('providerScope')
        expect(row.reconciliation?.allowed).toBe(false)
      }
      const expired = new Date(Date.now() - 10000)
      await context.prisma.backgroundEffectEvidence.updateMany({
        where: { workId: emailWork.id, incarnation: { in: incarnations } },
        data: { nominalDeadline: expired, firstDispatchAt: new Date(expired.getTime() - 86400000) },
      })
      const refreshed = await request(context.app.getHttpServer())
        .get(`${base}/works/email/jobs?source=PG_evidence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const retained = workPageSchema
        .parse(refreshed.body)
        .rows.find((row) => row.identity.incarnation === incarnations[0])!
      expect(retained.reconciliation?.allowed).toBe(true)
      const disposition = {
        revision: retained.reconciliation!.revision,
        incarnation: retained.identity.incarnation,
        disposition: 'acknowledged_unknown',
        reason: 'Expired immutable horizon inspected',
        references: ['incident_42'],
      }
      await request(context.app.getHttpServer())
        .post(`${base}/works/email/jobs/${id}/reconciliation`)
        .set('Authorization', `Bearer ${token}`)
        .send(disposition)
        .expect(204)
      await request(context.app.getHttpServer())
        .post(`${base}/works/email/jobs/${id}/reconciliation`)
        .set('Authorization', `Bearer ${token}`)
        .send(disposition)
        .expect(409)
      expect(await store.read(emailWork.id, retained.identity.incarnation!)).toMatchObject({
        certainty: 'unknown',
        outcomeRecorded: false,
        unresolvedCount: 1,
        autoStartsUsed: 1,
        manualGrant: 'none',
        disposition: 'acknowledged_unknown',
      })
      expect(connection).not.toHaveBeenCalled()
    } finally {
      connection.mockRestore()
    }
    await request(context.app.getHttpServer())
      .get(`${base}/works/image/jobs?source=PG_evidence`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
  })

  it('uses a real read-only Redis settlement barrier to acknowledge a lost queue-command reply without redispatch', async () => {
    token = await actor()
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    const principal = {
      type: 'jwt' as const,
      sub: claims.sub as string,
      sid: claims.sid as string,
      systemRole: SystemRole.SuperAdmin,
    }
    const summary = (await catalogue()).find((row) => row.id === imageWork.id)!
    const input: WorkCommand = {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: imageWork.id,
      operation: summary.paused ? 'resume' : 'pause',
      expectedWorkRevision: summary.revision!,
      targets: [],
      parameters: {},
      reason: 'Fault-injected lost broker reply',
    }
    const queue = context.app
      .get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
      .get(imageWork.queue!.name)!
    const port = queueCommandPort(context.app.get(ControlConnection), queue.toKey(''), input)
    const dispatch = jest.fn<typeof port.dispatch>(async (target) => {
      expect((await port.dispatch(target)).state).toBe('applied')
      throw new Error('Injected lost acknowledgement after actual Lua application')
    })
    const pending = await context.app
      .get(BackgroundCommandService)
      .execute(principal, input, imageWork.definitionVersion, {
        observe: () => port.observe(),
        dispatch,
      })
    expect(pending.unknownCount).toBe(1)
    const expired = new Date(Date.now() - 10000)
    await context.prisma.backgroundCommand.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    await context.prisma.backgroundCommandTarget.updateMany({
      where: { commandId: input.commandId },
      data: { dispatchUntil: expired },
    })
    const before = await queue.isPaused()
    const response = await request(context.app.getHttpServer())
      .post(`${base}/commands/${input.commandId}/reconciliation`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        revision: pending.revision,
        disposition: 'acknowledged_unknown',
        reason: 'Inspected Lua event; outcome uncertainty accepted',
        references: ['incident_42'],
      })
      .expect(200)
    expect(workReceiptSchema.parse(response.body).targets[0]).toMatchObject({
      state: 'unknown',
      resolution: 'acknowledged_unknown',
    })
    await context.prisma.backgroundBudget.updateMany({ data: { virtualTime: {} } })
    const replay = await request(context.app.getHttpServer())
      .post(`${base}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send(input)
      .expect(202)
    expect(workReceiptSchema.parse(replay.body).unknownCount).toBe(1)
    expect(await queue.isPaused()).toBe(before)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('defers actual provider retry claims until the lost ADMIN finalization commits, without spending a grant', async () => {
    token = await actor()
    const queues = context.app.get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
    const queue = queues.get(emailWork.queue!.name)!
    if ((await catalogue()).find((row) => row.id === emailWork.id)!.paused)
      await command('resume', emailWork.id)
    expect((await catalogue()).find((row) => row.id === emailWork.id)!.paused).toBe(false)
    const provider = context.app.get<EmailProvider>('EmailProvider').queuedEmail!
    let calls = 0
    const send = jest
      .spyOn(provider, 'send')
      .mockImplementation(async (_body, _key, _signal, beforeTransport) => {
        beforeTransport()
        calls += 1
        return calls === 1
          ? { certainty: 'none', retryable: true, code: 'RATE_LIMITED' }
          : { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
      })
    const binding = context.app
      .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS)
      .find(({ workId }) => workId === emailWork.id)!
    const host = context.app.get<WorkerHost>(binding.host)
    const failed = once(host.worker, 'failed')
    const producer = context.app.get<ManagedProducer<typeof emailWork>>(emailWork.tokens.producer)
    const identity = await producer.add(
      JobName.SEND_EMAIL,
      {
        template: EmailTemplate.WELCOME,
        to: 'manual@example.test',
        data: { name: 'Manual', email: 'manual@example.test' },
      },
      { jobId: 'provider-manual-finalize', attempts: 1 }
    )
    await failed
    const page = workPageSchema.parse(
      (
        await request(context.app.getHttpServer())
          .get(`${base}/works/email/jobs?state=failed`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body
    )
    const target = page.rows.find((row) => row.identity.id === identity.jobId)!.identity
    const current = (await catalogue()).find((row) => row.id === emailWork.id)!
    const input: WorkCommand = {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: emailWork.id,
      operation: 'retry',
      expectedWorkRevision: current.revision!,
      targets: [target],
      parameters: {},
      reason: 'Retry conformance with lost finalization',
    }
    const settlement = context.app.get(BackgroundCommandSettlement)
    const finalize = jest
      .spyOn(settlement, 'finalize')
      .mockRejectedValue(new Error('INJECTED_FINALIZE_OUTAGE'))
    try {
      const claimed = once(host.worker, 'active')
      const response = await request(context.app.getHttpServer())
        .post(`${base}/commands`)
        .set('Authorization', `Bearer ${token}`)
        .send(input)
      expect({ status: response.status, targets: response.body.targets }).toEqual({
        status: 200,
        targets: [expect.objectContaining({ state: 'dispatching' })],
      })
      expect(response.body.state).toBe('applying')
      await claimed
      // Another actual claim proves the first was deferred, not failed/exhausted.
      const [reclaimed] = await once(host.worker, 'active')
      expect(reclaimed.id).toBe(identity.jobId)
      const row = await context.app
        .get(ProviderEvidenceStore)
        .read(emailWork.id, identity.incarnation)
      expect(row).toMatchObject({
        commandFence: input.commandId,
        manualGrant: 'reserved',
        autoStartsUsed: 1,
        activeAttemptId: null,
        certainty: 'none',
      })
      expect(calls).toBe(1)
      expect((await queue.getJob(identity.jobId))!.attemptsMade).toBe(1)
      finalize.mockRestore()
      const completed = once(host.worker, 'completed')
      await context.app.get(PgOutcomeBuffer).retryPending()
      const [finished] = await completed
      expect(finished.id).toBe(identity.jobId)
      expect(calls).toBe(2)
      expect(
        await context.app.get(ProviderEvidenceStore).read(emailWork.id, identity.incarnation)
      ).toMatchObject({
        certainty: 'accepted',
        manualGrant: 'spent',
        autoStartsUsed: 1,
        commandFence: null,
      })
      expect(
        workReceiptSchema.parse(
          (
            await request(context.app.getHttpServer())
              .get(`${base}/commands/${input.commandId}`)
              .set('Authorization', `Bearer ${token}`)
              .expect(200)
          ).body
        ).state
      ).toBe('applied')
    } finally {
      finalize.mockRestore()
      send.mockRestore()
    }
  }, 30000)

  it('projects current typed business failures through the generic API without raw error leaks', async () => {
    token = await actor()
    if ((await catalogue()).find((row) => row.id === imageWork.id)!.paused)
      await command('resume', imageWork.id)
    const binding = context.app
      .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS)
      .find((row) => row.workId === imageWork.id)!
    const host = context.app.get<WorkerHost>(binding.host)
    const handler = context.app.get(ImageWorkHandler)
    const producer = context.app.get<ManagedProducer<typeof imageWork>>(imageWork.tokens.producer)
    for (const [name, error, code, permanent] of [
      [
        'known-permanent',
        new WorkFailure('corrupted_file', { permanent: true }),
        'corrupted_file',
        true,
      ],
      [
        'known-transient',
        new WorkFailure('storage_unavailable', { permanent: false }),
        'storage_unavailable',
        false,
      ],
      ['unknown-permanent', new WorkFailure('undeclared', { permanent: true }), undefined, true],
      [
        'secret-error',
        new Error('https://private.example/token?secret=DO_NOT_EXPOSE'),
        undefined,
        false,
      ],
    ] as const) {
      token = await actor()
      const fault = jest.spyOn(handler, 'run').mockRejectedValueOnce(error)
      try {
        const failed = once(host.worker, 'failed')
        const identity = await producer.add(
          'render',
          { businessRequestId: name, transformVersion: 1 },
          { jobId: name, attempts: 1 }
        )
        const [, failure] = await failed
        expect(failure.message).toBe(permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE')
        const response = await request(context.app.getHttpServer())
          .get(`${base}/works/image/jobs/${identity.jobId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        expect(response.body.failure?.code).toBe(code)
        expect(JSON.stringify(response.body)).not.toMatch(
          /DO_NOT_EXPOSE|private\.example|stacktrace/
        )
        expect(response.body.failure).toEqual(
          code ? { code, ...imageWork.failureReasons![code]! } : undefined
        )
        expect(
          response.body.capabilities.find((cap: { operation: string }) => cap.operation === 'retry')
            .allowed
        ).toBe(!permanent)
        const broker = await context.app
          .get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
          .get('image')!
          .getBackend().client
        const key = context.app
          .get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
          .get('image')!
          .toKey(identity.jobId)
        expect(await broker.hget(key, 'failedReason')).toBe(
          permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE'
        )
        // Losing the recorded diagnostic cannot remove the independent safe permanent witness.
        await broker.hset(key, { amMetadata: JSON.stringify({ report: 'unrecorded' }) })
        const lost = await request(context.app.getHttpServer())
          .get(`${base}/works/image/jobs/${identity.jobId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
        expect(lost.body.failure).toBeUndefined()
        expect(
          lost.body.capabilities.find((cap: { operation: string }) => cap.operation === 'retry')
            .allowed
        ).toBe(!permanent)
      } finally {
        fault.mockRestore()
      }
    }
    const importId = 'typed-import-failure'
    await context.prisma
      .$executeRaw`INSERT INTO core.fixture_imports (id, incarnation, state, failure_code)
      VALUES (${importId}, ${uuidv4()}::uuid, 'failed', 'invalid_import')`
    const domain = await request(context.app.getHttpServer())
      .get(`${base}/works/fixture-import/jobs/${importId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(domain.body.failure).toEqual({
      code: 'invalid_import',
      ...importWork.failureReasons!.invalid_import!,
    })
    expect(domain.body.source).toBe('domain')
  }, 30000)

  it('allows idempotent BUSINESS execution before a lost ADMIN receipt finalizes without redispatch or a second grant', async () => {
    token = await actor()
    const queue = context.app.get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY).get('image')!
    if ((await catalogue()).find((row) => row.id === imageWork.id)!.paused)
      await command('resume', imageWork.id)
    const binding = context.app
      .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS)
      .find(({ workId }) => workId === imageWork.id)!
    const host = context.app.get<WorkerHost>(binding.host)
    const handler = context.app.get(ImageWorkHandler)
    const run = jest
      .spyOn(handler, 'run')
      .mockRejectedValueOnce(new Error('TRANSIENT_FIXTURE_FAILURE'))
    const failed = once(host.worker, 'failed')
    const identity = await context.app
      .get<ManagedProducer<typeof imageWork>>(imageWork.tokens.producer)
      .add(
        'render',
        { businessRequestId: 'unknown-admin-business', transformVersion: 1 },
        { jobId: 'unknown-admin-business', attempts: 1 }
      )
    await failed
    const page = await request(context.app.getHttpServer())
      .get(`${base}/works/image/jobs?state=failed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    const target = workPageSchema
      .parse(page.body)
      .rows.find((row) => row.identity.id === identity.jobId)!.identity
    const current = (await catalogue()).find((row) => row.id === imageWork.id)!
    const input: WorkCommand = {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: imageWork.id,
      operation: 'retry',
      expectedWorkRevision: current.revision!,
      targets: [target],
      parameters: {},
      reason: 'Idempotent execution during unavailable receipt finalization',
    }
    const finalize = jest
      .spyOn(context.app.get(BackgroundCommandSettlement), 'finalize')
      .mockRejectedValue(new Error('INJECTED_FINALIZE_OUTAGE'))
    try {
      const completed = once(host.worker, 'completed')
      const response = await request(context.app.getHttpServer())
        .post(`${base}/commands`)
        .set('Authorization', `Bearer ${token}`)
        .send(input)
        .expect(200)
      expect(response.body.state).toBe('applying')
      const [finished] = await completed
      expect(finished.id).toBe(identity.jobId)
      expect(run).toHaveBeenCalledTimes(2)
      expect(
        await context.prisma.$queryRaw`SELECT output_reference FROM core.image_fixture_outputs
        WHERE business_request_id = 'unknown-admin-business'`
      ).toEqual([{ output_reference: 'fixture-output:unknown-admin-business:1' }])
      const broker = await queue.getBackend().client
      const before = await broker.hgetall(queue.toKey(identity.jobId))
      expect(before).toMatchObject({ amAutoStartsUsed: '1', amManualGrant: 'spent' })
      // Fixture expiry advances only the administrative dispatch deadlines, not business state.
      await context.prisma.backgroundCommand.updateMany({
        where: { commandId: input.commandId },
        data: { dispatchUntil: new Date(0) },
      })
      await context.prisma.backgroundCommandTarget.updateMany({
        where: { commandId: input.commandId },
        data: { dispatchUntil: new Date(0) },
      })
      const receipt = await request(context.app.getHttpServer())
        .get(`${base}/commands/${input.commandId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(workReceiptSchema.parse(receipt.body).unknownCount).toBe(1)
      const replay = await request(context.app.getHttpServer())
        .post(`${base}/commands`)
        .set('Authorization', `Bearer ${token}`)
        .send(input)
        .expect(202)
      expect(workReceiptSchema.parse(replay.body).unknownCount).toBe(1)
      expect(await broker.hgetall(queue.toKey(identity.jobId))).toEqual(before)
      expect(run).toHaveBeenCalledTimes(2)
      expect(
        await context.prisma.backgroundEffectEvidence.count({ where: { workId: imageWork.id } })
      ).toBe(0)
      expect(
        await context.prisma.auditLog.count({
          where: {
            action: 'background_work.command_intent',
            targetId: imageWork.id,
            metadata: { path: ['commandId'], equals: input.commandId },
          },
        })
      ).toBe(1)
    } finally {
      finalize.mockRestore()
      run.mockRestore()
      await context.app.get(PgOutcomeBuffer).retryPending()
    }
  }, 30000)

  it('refuses cancel after an actual provider start while allowing the active attempt to finish', async () => {
    token = await actor()
    const queue = context.app
      .get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
      .get(emailWork.queue!.name)!
    const provider = context.app.get<EmailProvider>('EmailProvider').queuedEmail!
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const transport = new Promise<void>((resolve) => {
      started = resolve
    })
    let calls = 0
    const send = jest
      .spyOn(provider, 'send')
      .mockImplementation(async (_body, _key, _signal, beforeTransport) => {
        beforeTransport()
        calls += 1
        started()
        await gate
        return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
      })
    const binding = context.app
      .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS)
      .find(({ workId }) => workId === emailWork.id)!
    const host = context.app.get<WorkerHost>(binding.host)
    const completed = once(host.worker, 'completed')
    try {
      if ((await catalogue()).find((row) => row.id === emailWork.id)!.paused)
        await command('resume', emailWork.id)
      expect((await catalogue()).find((row) => row.id === emailWork.id)!.paused).toBe(false)
      const identity = await context.app
        .get<ManagedProducer<typeof emailWork>>(emailWork.tokens.producer)
        .add(
          JobName.SEND_EMAIL,
          {
            template: EmailTemplate.WELCOME,
            to: 'active@example.test',
            data: { name: 'Active', email: 'active@example.test' },
          },
          { jobId: 'provider-active-cancel', attempts: 1 }
        )
      await transport
      const page = workPageSchema.parse(
        (
          await request(context.app.getHttpServer())
            .get(`${base}/works/email/jobs?state=active`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body
      )
      const target = page.rows.find((row) => row.identity.id === identity.jobId)!.identity
      const receipt = await command('cancel', emailWork.id, [target])
      expect(receipt.state).toBe('rejected')
      expect(receipt.targets[0]!.reason).toBe('OUTCOME_UNRECORDED')
      expect(await (await queue.getJob(identity.jobId))!.getState()).toBe('active')
      expect(calls).toBe(1)
      release()
      expect((await completed)[0].id).toBe(identity.jobId)
      expect(
        await context.app.get(ProviderEvidenceStore).read(emailWork.id, identity.incarnation)
      ).toMatchObject({
        certainty: 'accepted',
        autoStartsUsed: 1,
        manualGrant: 'none',
        commandFence: null,
      })
    } finally {
      release()
      send.mockRestore()
    }
  }, 30000)

  it('rate-limits invalid bearer floods before command auth and never creates an ADMIN intent', async () => {
    const before = await context.prisma.backgroundCommand.count()
    const replies = await Promise.all(
      Array.from({ length: 75 }, () =>
        request(context.app.getHttpServer())
          .post(`${base}/commands`)
          .set('Authorization', 'Bearer <invalid-fake-token>')
          .send({})
      )
    )
    expect(
      replies.some((response) => response.status === 429 && response.headers['retry-after'])
    ).toBe(true)
    expect(replies.every((response) => [401, 429].includes(response.status))).toBe(true)
    expect(await context.prisma.backgroundCommand.count()).toBe(before)
  })
  it.each([5000, 10000])(
    'resumes actual registered worker claims through API after paused producers enqueue%i jobs',
    async (count) => {
      token = await actor()
      const queues = context.app.get<ReadonlyMap<string, Queue>>(QUEUE_REGISTRY)
      const queue = queues.get(imageWork.queue!.name)!
      const current = (await catalogue()).find((row) => row.id === imageWork.id)!
      if (!current.paused) await command('pause', imageWork.id)
      expect((await catalogue()).find((row) => row.id === imageWork.id)!.paused).toBe(true)
      await queue.drain(true)
      const producer = context.app.get<ManagedProducer<typeof imageWork>>(imageWork.tokens.producer)
      for (let offset = 0; offset < count; offset += 100)
        await Promise.all(
          Array.from({ length: Math.min(100, count - offset) }, (_, index) =>
            producer.add(
              'render',
              { businessRequestId: `api-p1-${count}-${offset + index}`, transformVersion: 1 },
              { jobId: `api-p1-${count}-${offset + index}`, attempts: 1 }
            )
          )
        )
      expect(await queue.getWaitingCount()).toBe(count)
      const binding = context.app
        .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS)
        .find(({ workId }) => workId === imageWork.id)!
      const host = context.app.get<WorkerHost>(binding.host)
      const claimed = once(host.worker, 'active')
      const completed = once(host.worker, 'completed')
      try {
        expect((await command('resume', imageWork.id)).state).toBe('applied')
        const [job] = await claimed
        expect(job.id).toMatch(new RegExp(`^api-p1-${count}-`))
        // Pause again while the backlog is still large; active work is permitted to finish.
        expect((await command('pause', imageWork.id)).state).toBe('applied')
        await completed
        expect(
          await context.prisma.backgroundEffectEvidence.count({ where: { workId: imageWork.id } })
        ).toBe(0)
      } finally {
        // Isolated fixture cleanup only; not an operator command or an application recovery recipe.
        await queue.drain(true)
        if (!current.paused) {
          token = await actor()
          await command('resume', imageWork.id)
        }
      }
    },
    90000
  )
})
