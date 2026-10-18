import { scheduler } from 'node:timers/promises'

import { createInvitationOperationId } from '@amcore/shared'

import { InvitationEmailService } from '../src/core/organizations/invitation-email.service'
import { ProvisioningLimiterService } from '../src/core/organizations/provisioning/provisioning-limiter.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareManagedInvitation } from './managed-invitation-fixture'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('Explicit supersession and inconsistent managed owners (e2e)', () => {
  let context: E2ETestContext
  let fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>
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
    fixture.restore()
    import.meta.jest.restoreAllMocks()
  })
  const send = (orgId: string, body: object) =>
    fixture
      .http()
      .post(`/admin/organizations/${orgId}/administrator-invitations`)
      .auth(fixture.token, { type: 'bearer' })
      .send(body)
  it.each(['initial', 'additional'] as const)(
    'never supersedes the %s owner or consumes mail quota',
    async (kind) => {
      const { orgId, current } = await prepareManagedInvitation(context, fixture, kind)
      const before = await context.prisma.orgInvite.findUniqueOrThrow({
        where: { id: current.id },
        include: { roleIntents: true },
      })
      const quota = import.meta.jest.spyOn(context.app.get(ProvisioningLimiterService), 'consume')
      const response = await send(orgId, {
        operationId: createInvitationOperationId(),
        email: current.emailCanonical,
        supersedesInvite: { id: current.id, generation: current.generation },
        reason: 'TEST-49 no managed override',
      })
      expect(response.status).toBe(409)
      expect(response.body.errorCode).toBe(
        kind === 'initial' ? 'ADMIN_INITIAL_SETUP_PENDING' : 'PROVISIONING_MANAGED'
      )
      expect(
        await context.prisma.orgInvite.findUniqueOrThrow({
          where: { id: current.id },
          include: { roleIntents: true },
        })
      ).toEqual(before)
      expect(quota).not.toHaveBeenCalled()
    }
  )
  it('requires exact explicit supersession for an unmarked invite and preserves its old role intent', async () => {
    const { orgId, token, roleId } = await prepareManagedInvitation(context, fixture, 'additional')
    const email = 'ordinary@e2e.amcore.test'
    await fixture
      .http()
      .post(`/organizations/${orgId}/invites`)
      .auth(token, { type: 'bearer' })
      .set('X-Invitation-Operation-Id', createInvitationOperationId())
      .send({ email, roleIds: [roleId] })
      .expect(202)
    const old = await context.prisma.orgInvite.findFirstOrThrow({
      where: { organizationId: orgId, emailCanonical: email },
    })
    const quota = import.meta.jest.spyOn(context.app.get(ProvisioningLimiterService), 'consume')
    const input = {
      operationId: createInvitationOperationId(),
      email,
      reason: 'TEST-49 authorized supersession',
    }
    const conflict = await send(orgId, input).expect(409)
    expect(conflict.body).toMatchObject({
      errorCode: 'ADMIN_INVITATION_ALREADY_PENDING',
      details: { supersedesInvite: { id: old.id, generation: 1 } },
    })
    await send(orgId, {
      ...input,
      operationId: createInvitationOperationId(),
      supersedesInvite: { id: old.id, generation: 9 },
    }).expect(409)
    expect(quota).not.toHaveBeenCalled()
    const created = await send(orgId, {
      ...input,
      operationId: createInvitationOperationId(),
      supersedesInvite: { id: old.id, generation: 1 },
    }).expect(201)
    expect(quota).toHaveBeenCalledTimes(1)
    const oldAfter = await context.prisma.orgInvite.findUniqueOrThrow({
      where: { id: old.id },
      include: { roleIntents: true },
    })
    expect(oldAfter.revokedAt).toBeInstanceOf(Date)
    expect(oldAfter.roleIntents[0]!.requestedRoleId).toBe(roleId)
    const intent = await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
      where: { id: created.body.administratorInvitationId },
      include: { currentInvite: { include: { roleIntents: true } } },
    })
    expect(intent.currentInvite!.roleIntents.map((role) => role.roleNameAtIssue)).toEqual(['ADMIN'])
  })
  it('refuses additional recovery with inconsistent generation instead of repairing it', async () => {
    const { orgId, current } = await prepareManagedInvitation(context, fixture, 'additional')
    const row = await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()
    await context.prisma.organizationAdministratorInvitation.update({
      where: { id: row.id },
      data: { currentGeneration: 9 },
    })
    const quota = import.meta.jest.spyOn(context.app.get(ProvisioningLimiterService), 'consume')
    await fixture
      .http()
      .post(`/admin/organizations/${orgId}/administrator-invitations/${row.id}/reissue`)
      .auth(fixture.token, { type: 'bearer' })
      .send({
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
        expectedInviteId: current.id,
        expectedGeneration: 1,
        reason: 'TEST-49 corrupt pointer',
      })
      .expect(409)
    expect(quota).not.toHaveBeenCalled()
    expect(
      (
        await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).currentGeneration
    ).toBe(9)
    expect(
      (await context.prisma.orgInvite.findUniqueOrThrow({ where: { id: current.id } })).generation
    ).toBe(1)
  })
  it('never reuses a create identity for recovery or a recovery identity for create', async () => {
    const { orgId } = await prepareManagedInvitation(context, fixture, 'additional')
    const row = await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()
    const cancel = (operationId: string) =>
      fixture
        .http()
        .post(`/admin/organizations/${orgId}/administrator-invitations/${row.id}/cancel`)
        .auth(fixture.token, { type: 'bearer' })
        .send({ operationId, expectedRevision: 1, reason: 'TEST-49 identity boundary' })
    await cancel(row.id)
      .expect(409)
      .expect((res) => expect(res.body.errorCode).toBe('ADMIN_INTENT_MISMATCH'))
    expect(
      (
        await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).state
    ).toBe('awaiting')
    const operationId = createInvitationOperationId()
    await cancel(operationId).expect(200)
    await send(orgId, {
      operationId,
      email: 'another@e2e.amcore.test',
      reason: 'TEST-49 identity boundary',
    })
      .expect(409)
      .expect((res) => expect(res.body.errorCode).toBe('ADMIN_INTENT_MISMATCH'))
    const recovered = await fixture
      .http()
      .get(`/admin/organizations/${orgId}/administrator-operations/${operationId}`)
      .auth(fixture.token, { type: 'bearer' })
      .expect(200)
    expect(recovered.body.receipt.administratorInvitationId).toBe(row.id)
    expect(
      await context.prisma.organizationAdministratorInvitation.count({
        where: { organizationId: orgId },
      })
    ).toBe(1)
  })
  it('rejects duplicate managed owners on recipient consent without creating a grant', async () => {
    const { orgId, current } = await prepareManagedInvitation(context, fixture, 'initial')
    await context.prisma.organizationAdministratorInvitation.create({
      data: {
        id: createInvitationOperationId(),
        organizationId: orgId,
        creatorUserId: fixture.operatorId,
        fingerprint: 'a'.repeat(64),
        currentInviteId: current.id,
        currentGeneration: current.generation,
      },
    })
    const recipient = await prepareProvisioningRecipient(context, fixture)
    await recipient
      .inspect()
      .expect(409)
      .expect((res) => expect(res.body.errorCode).toBe('PROVISIONING_MANAGED'))
    await recipient.accept().expect(409)
    expect(await context.prisma.orgMember.count({ where: { userId: recipient.id } })).toBe(0)
    expect((await context.prisma.organizationProvisioning.findFirstOrThrow()).state).toBe(
      'awaiting'
    )
    expect(
      (await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()).state
    ).toBe('awaiting')
  })

  it('serializes identical create requests across the shared operation boundary with one mail attempt', async () => {
    const { orgId } = await prepareManagedInvitation(context, fixture, 'additional')
    const input = {
      operationId: createInvitationOperationId(),
      email: 'concurrent@e2e.amcore.test',
      reason: 'TEST-49 concurrent exact replay',
    }
    const dispatch = import.meta.jest.mocked(context.app.get(InvitationEmailService).dispatch)
    const before = dispatch.mock.calls.length
    const fence = invitationFence(
      context.prisma,
      (model, method) => model === 'organizationAdministratorInvitation' && method === 'create'
    )
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
      const winner = send(orgId, input).then((response) => response)
      first = winner
      await fence.waitFor(winner)
      const waiter = send(orgId, input).then((response) => response)
      second = waiter
      let waiting = false
      const deadline = Date.now() + 1000
      while (!waiting && Date.now() < deadline) {
        const [row] = await context.prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${fence.pid()}=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock%') AS waiting`
        waiting = !!row?.waiting
        if (!waiting) await scheduler.yield()
      }
      expect(waiting).toBe(true)
      fence.release()
      const [a, b] = await Promise.all([winner, waiter])
      expect([a.status, b.status]).toEqual([201, 201])
      expect(a.body).toEqual(b.body)
      expect(dispatch.mock.calls.length - before).toBe(1)
      expect(
        await context.prisma.organizationAdministratorInvitation.count({
          where: { id: input.operationId },
        })
      ).toBe(1)
    } finally {
      fence.restore()
      await Promise.allSettled([first, second])
    }
  })
})
