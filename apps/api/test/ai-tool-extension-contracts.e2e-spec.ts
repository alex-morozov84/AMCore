import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import { SchedulerRegistry } from '@nestjs/schedule'
import request from 'supertest'

import { Action, Subject } from '@amcore/shared'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { ConflictException, ForbiddenException, NotFoundException } from '../src/common/exceptions'
import { AiApprovalService } from '../src/core/ai/approvals/ai-approval.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AiToolActionService } from '../src/infrastructure/ai/runs/ai-tool-action.service'
import { AiToolContractRegistry } from '../src/infrastructure/ai/tools/ai-tool-contract.registry'
import { prepareToolIntent } from '../src/infrastructure/ai/tools/ai-tool-intent'
import type { AttemptRuntime } from '../src/infrastructure/worker-lifecycle'

import { deferred, until } from './fixtures/ai-run-controls'
import { closeManagedWorker } from './fixtures/background-work/close-managed-worker'
import {
  FixtureOrganizationAuthority,
  fixtureOrganizationRegistration,
  FixtureOrganizationTool,
} from './fixtures/extension-contracts/domain-tool'
import { registerFixtureToolEntries } from './fixtures/extension-contracts/tool-registration'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  setupE2ETest,
  signAccessToken,
  teardownE2ETest,
} from './helpers'

/** Uses existing organizations and primary CASL permissions; no synthetic allow-all authority. */
describe('Permission-aware tool extension (PostgreSQL)', () => {
  let context: E2ETestContext
  let owner: string
  let org: string
  let role: string
  let assistant: string
  let conversation: string
  let readPermission: string
  let updatePermission: string
  let dispatch: AiRunDispatchService
  let approvals: AiApprovalService
  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      registerFixtureToolEntries(builder, [fixtureOrganizationRegistration])
    )
    for (const job of context.app.get(SchedulerRegistry).getCronJobs().values()) job.stop()
    await closeManagedWorker(context.app, 'ai-runs')
    dispatch = context.app.get(AiRunDispatchService)
    approvals = context.app.get(AiApprovalService)
    await context.prisma.$executeRaw`CREATE TABLE core.extension_fixture_tool_effects (
      key text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE)`
  }, 180000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    const prisma = context.prisma
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(prisma)
    await context.app.get(AiModelRegistry).invalidate()
    const email = `${randomUUID()}@example.com`
    owner = (
      await prisma.user.create({ data: { email, emailCanonical: email, passwordHash: 'fixture' } })
    ).id
    org = (
      await prisma.organization.create({
        data: { name: 'Fixture organization', slug: randomUUID() },
      })
    ).id
    role = (await prisma.role.create({ data: { name: 'fixture-role', organizationId: org } })).id
    for (const action of [Action.Read, Action.Update]) {
      const permission = await prisma.permission.create({
        data: {
          organizationId: org,
          subject: Subject.Organization,
          action,
          fields: ['name'],
          conditions: { id: '${user.organizationId}' },
          roles: { create: { roleId: role } },
        },
      })
      if (action === Action.Read) readPermission = permission.id
      else updatePermission = permission.id
    }
    await prisma.orgMember.create({
      data: { userId: owner, organizationId: org, roles: { create: { roleId: role } } },
    })
    assistant = (
      await prisma.aiAssistant.create({
        data: {
          slug: randomUUID(),
          version: 1,
          displayName: 'Fixture assistant',
          enabled: true,
          modelSelection: { modelSlug: 'mock-default' },
          allowedModalities: ['text'],
          toolAllowlist: [fixtureOrganizationRegistration.contract.toolId],
        },
      })
    ).id
    conversation = (
      await prisma.aiConversation.create({
        data: {
          ownerUserId: owner,
          organizationId: org,
          assistantId: assistant,
        },
      })
    ).id
  })

  async function park() {
    const run = await context.app.get(AiRunProducerService).create(owner, {
      conversationId: conversation,
      inputParts: [{ type: 'text', text: '__mock_tool__:fixture_rename_organization' }],
    })
    await dispatch.drainDueBatches()
    const approval = await context.prisma.aiApproval.findFirstOrThrow({ where: { runId: run.id } })
    expect(approval.intentHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'WAITING_APPROVAL'
    )
    return { run, approval }
  }
  async function effects() {
    return context.prisma.$queryRaw<
      { key: string }[]
    >`SELECT key FROM core.extension_fixture_tool_effects`
  }
  async function revoke(permissionId: string) {
    await context.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${owner} FOR SHARE`
      await tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${org} FOR UPDATE`
      await tx.rolePermission.delete({
        where: { roleId_permissionId: { roleId: role, permissionId } },
      })
      await tx.organization.update({ where: { id: org }, data: { aclVersion: { increment: 1 } } })
    })
  }

  it('shows an immutable significant preview, approves its hash and applies one real domain effect', async () => {
    const { approval } = await park()
    const listed = (await approvals.list(owner, { status: 'pending' })).data[0]!
    expect(listed.disclosure).toBe('available')
    expect(listed.preview?.target.id).toBe(org)
    expect(listed.preview?.effects).toEqual(['Name becomes Fixture organization fixture'])
    await approvals.decide(owner, approval.id, {
      decision: 'approve',
      intentHash: listed.intentHash!,
    })
    await dispatch.drainDueBatches()
    expect((await context.prisma.organization.findUniqueOrThrow({ where: { id: org } })).name).toBe(
      'Fixture organization fixture'
    )
    expect(await effects()).toHaveLength(1)
    await approvals.decide(owner, approval.id, {
      decision: 'approve',
      intentHash: listed.intentHash!,
    })
    expect(await effects()).toHaveLength(1)
  })

  it('redacts after read revoke, refuses approval but permits owner rejection with the same hash', async () => {
    const { approval } = await park()
    await revoke(readPermission)
    const listed = (await approvals.list(owner, { status: 'pending' })).data[0]!
    expect(listed).toMatchObject({ preview: null, disclosure: 'unavailable' })
    await expect(
      approvals.decide(owner, approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash!,
      })
    ).rejects.toBeInstanceOf(ForbiddenException)
    await approvals.decide(owner, approval.id, {
      decision: 'reject',
      intentHash: approval.intentHash!,
    })
    await dispatch.drainDueBatches()
    expect(await effects()).toHaveLength(0)
  })

  it.each(['permission', 'allowlist'])(
    'does not execute after %s alone is revoked after approval',
    async (change) => {
      const { approval } = await park()
      await approvals.decide(owner, approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash!,
      })
      if (change === 'permission') await revoke(updatePermission)
      else
        await context.prisma.aiAssistant.update({
          where: { id: assistant },
          data: { toolAllowlist: [] },
        })
      await dispatch.drainDueBatches()
      expect(await effects()).toHaveLength(0)
    }
  )

  it('refuses expiry during asynchronous host authority with fresh PG time and zero effect', async () => {
    const { run, approval } = await park()
    await approvals.decide(owner, approval.id, {
      decision: 'approve',
      intentHash: approval.intentHash!,
    })
    await context.prisma
      .$executeRaw`UPDATE ai.ai_runs SET "deadlineAt" = clock_timestamp() + interval '1 second' WHERE id = ${run.id}`
    const [claim] = await context.app.get(AiRunRepository).claimDueBatch(1)
    expect(claim).toBeDefined()
    const action = await context.prisma.aiToolInvocation.findFirstOrThrow({
      where: { runId: run.id },
    })
    const authority = context.app.get(FixtureOrganizationAuthority)
    const original = authority.authorize.bind(authority)
    const entered = deferred()
    const release = deferred()
    const hook = jest
      .spyOn(authority, 'authorize')
      .mockImplementation(async (tx, intent, phase) => {
        await original(tx, intent, phase)
        entered.resolve()
        await release.promise
      })
    const transport = jest.fn()
    const pending = context.app.get(AiToolActionService).execute(
      {
        claim: claim!,
        ownerUserId: owner,
        organizationId: org,
        runtime: {
          attempt: { signal: new AbortController().signal },
          onTransportStarted: transport,
        } as unknown as AttemptRuntime,
      },
      action,
      context.app.get(FixtureOrganizationTool),
      'fixture-call'
    )
    try {
      await entered.promise
      await until(async () => {
        const [row] = await context.prisma.$queryRaw<
          { expired: boolean }[]
        >`SELECT clock_timestamp() >= ${claim!.deadlineAt} AS expired`
        return row!.expired
      })
      release.resolve()
      expect(await pending).toEqual({ status: 'terminal' })
    } finally {
      release.resolve()
      hook.mockRestore()
    }
    expect(await effects()).toHaveLength(0)
    expect(transport).not.toHaveBeenCalled()
    expect(await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'EXPIRED',
      terminalReasonCode: 'deadline_exceeded',
    })
    expect(
      await context.prisma.aiRunAttempt.findFirstOrThrow({
        where: { runId: run.id, epoch: claim!.epoch },
      })
    ).toMatchObject({ ioStartedAt: null })
    expect(
      await context.prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: action.id } })
    ).toMatchObject({ startedAt: null })
  })

  it('revocation after successful host authority refuses the atomic domain mutation and receipt', async () => {
    const { run, approval } = await park()
    await approvals.decide(owner, approval.id, {
      decision: 'approve',
      intentHash: approval.intentHash!,
    })
    const tool = context.app.get(FixtureOrganizationTool)
    const original = tool.execute.bind(tool)
    const entered = deferred()
    const release = deferred()
    const boundary = jest.spyOn(tool, 'execute').mockImplementation(async (intent, ctx) => {
      entered.resolve() // The host authority succeeded and EXECUTING admission committed.
      await release.promise
      return original(intent, ctx)
    })
    const draining = dispatch.drainDueBatches()
    try {
      await entered.promise
      expect(
        await context.prisma.aiToolInvocation.findFirstOrThrow({ where: { runId: run.id } })
      ).toMatchObject({ status: 'EXECUTING' })
      await revoke(updatePermission)
      release.resolve()
      await draining
    } finally {
      release.resolve()
      boundary.mockRestore()
    }
    expect(await effects()).toHaveLength(0)
    expect(
      await context.prisma.organization.findUniqueOrThrow({ where: { id: org } })
    ).toMatchObject({ name: 'Fixture organization' })
    expect(
      await context.prisma.aiToolInvocation.findFirstOrThrow({ where: { runId: run.id } })
    ).toMatchObject({ status: 'FAILED' })
  })

  it('a conflicting domain writer holds the organization lock; mutation rechecks committed rights and revision', async () => {
    const tool = context.app.get(FixtureOrganizationTool)
    const id = randomUUID().replaceAll('-', '')
    const ctx = {
      ownerUserId: owner,
      organizationId: org,
      runId: 'fixture-run',
      conversationId: conversation,
      invocationId: id,
      idempotencyKey: `ai-tool:${id}`,
    }
    const prepared = await context.prisma.$transaction((tx) =>
      prepareToolIntent(tool, {}, ctx, tx, 1, context.app.get(AiToolContractRegistry))
    )
    const locked = deferred<number>()
    const release = deferred()
    const writer = context.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${owner} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${org} FOR UPDATE`
        const [pid] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        locked.resolve(pid!.pid)
        await release.promise
        await tx.rolePermission.delete({
          where: { roleId_permissionId: { roleId: role, permissionId: updatePermission } },
        })
        await tx.organization.update({
          where: { id: org },
          data: { name: 'Concurrent writer', aclVersion: { increment: 1 } },
        })
      },
      { timeout: 10000 }
    )
    const pid = await locked.promise
    const mutation = tool.execute(prepared.intent as Parameters<typeof tool.execute>[0], ctx)
    const result = mutation.then(
      () => 'applied',
      () => 'refused'
    )
    try {
      await until(async () => {
        const [row] = await context.prisma.$queryRaw<
          { blocked: boolean }[]
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`
        return row!.blocked
      })
      release.resolve()
      await writer
      expect(await result).toBe('refused')
    } finally {
      release.resolve()
    }
    expect(await effects()).toHaveLength(0)
    expect(
      await context.prisma.organization.findUniqueOrThrow({ where: { id: org } })
    ).toMatchObject({
      name: 'Concurrent writer',
      aclVersion: (prepared.intent.target!.revision as number) + 1,
    })
  })

  it.each(['fields', 'deny', 'membership'] as const)(
    'current %s revocation refuses an approved domain effect',
    async (change) => {
      const { approval } = await park()
      await approvals.decide(owner, approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash!,
      })
      await context.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${org} FOR UPDATE`
        if (change === 'membership')
          await tx.orgMember.deleteMany({ where: { userId: owner, organizationId: org } })
        else if (change === 'fields')
          await tx.permission.update({
            where: { id: updatePermission },
            data: { fields: ['slug'] },
          })
        else
          await tx.permission.create({
            data: {
              organizationId: org,
              action: Action.Update,
              subject: Subject.Organization,
              fields: ['name'],
              inverted: true,
              conditions: { id: org },
              roles: { create: { roleId: role } },
            },
          })
        await tx.organization.update({ where: { id: org }, data: { aclVersion: { increment: 1 } } })
      })
      await dispatch.drainDueBatches()
      expect(await effects()).toHaveLength(0)
      expect(
        (await context.prisma.organization.findUniqueOrThrow({ where: { id: org } })).name
      ).toBe('Fixture organization')
    }
  )

  it('redacts a stored preview whose canonical invocation fields were substituted', async () => {
    const { approval } = await park()
    await context.prisma.aiToolInvocation.updateMany({
      where: { approvalId: approval.id },
      data: { toolVersion: 2 },
    })
    expect((await approvals.list(owner, {})).data[0]).toMatchObject({
      preview: null,
      disclosure: 'unavailable',
    })
    await expect(
      approvals.decide(owner, approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash!,
      })
    ).rejects.toBeInstanceOf(ConflictException)
    expect(await effects()).toHaveLength(0)
  })

  it('serves no-store owner preview over HTTP and refuses missing/hashless/extra decision input', async () => {
    const { approval } = await park()
    const token = signAccessToken(context.app, {
      sub: owner,
      email: 'fixture@example.com',
      systemRole: 'USER',
    })
    const server = context.app.getHttpServer()
    const listed = await request(server)
      .get('/ai/approvals')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(listed.headers['cache-control']).toBe('private, no-store')
    expect(listed.body.data[0].preview.target.id).toBe(org)
    for (const body of [
      { decision: 'approve' },
      { decision: 'approve', intentHash: approval.intentHash, args: {} },
    ])
      await request(server)
        .post(`/ai/approvals/${approval.id}/decision`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400)
    await request(server).get('/ai/approvals').expect(401)
    await revoke(readPermission)
    const hidden = await request(server)
      .get('/ai/approvals')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(hidden.body.data[0]).toMatchObject({ preview: null, disclosure: 'unavailable' })
    await request(server)
      .post(`/ai/approvals/${approval.id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approve', intentHash: approval.intentHash })
      .expect(403)
    const rejected = await request(server)
      .post(`/ai/approvals/${approval.id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'reject', intentHash: approval.intentHash })
      .expect(200)
    expect(rejected.headers['cache-control']).toBe('private, no-store')
    expect(rejected.body.preview).toBeNull()
    expect(await effects()).toHaveLength(0)
  })

  it('binds decisions before duplicates and gives foreign owners no approval authority', async () => {
    const { approval } = await park()
    await expect(
      approvals.decide('another-owner', approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash!,
      })
    ).rejects.toBeInstanceOf(NotFoundException)
    await approvals.decide(owner, approval.id, {
      decision: 'approve',
      intentHash: approval.intentHash!,
    })
    await expect(
      approvals.decide(owner, approval.id, { decision: 'approve', intentHash: '0'.repeat(64) })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('checks frozen revision and current rights inside the domain mutation transaction', async () => {
    const tool = context.app.get(FixtureOrganizationTool)
    const id = randomUUID().replaceAll('-', '')
    const ctx = {
      ownerUserId: owner,
      organizationId: org,
      runId: 'fixture-run',
      conversationId: conversation,
      invocationId: id,
      idempotencyKey: `ai-tool:${id}`,
    }
    const prepared = await context.prisma.$transaction((tx) =>
      prepareToolIntent(tool, {}, ctx, tx, 1, context.app.get(AiToolContractRegistry))
    )
    await context.prisma.organization.update({
      where: { id: org },
      data: { aclVersion: { increment: 1 } },
    })
    await expect(
      tool.execute(
        { ...prepared.intent, args: tool.normalizedSchema.parse(prepared.intent.args) },
        ctx
      )
    ).rejects.toThrow()
    expect(await effects()).toHaveLength(0)
  })
})
