import { createInvitationOperationId } from '@amcore/shared'

import { InvitationRetentionService } from '../src/core/invitations/invitation-retention.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { prepareProvisioningFixture } from './provisioning-fixture'

describe('Administrator attention and retention projection (e2e)', () => {
  let context: E2ETestContext
  let fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>
  beforeAll(async () => { context = await setupE2ETest(); await seedSystemRoles(context.prisma) }, 120000)
  afterAll(async () => { await teardownE2ETest(context) }, 120000)
  beforeEach(async () => { fixture = await prepareProvisioningFixture(context) })
  afterEach(() => fixture.restore())
  const get = (path: string) => fixture.http().get(`/admin/organizations/${path}`).auth(fixture.token, { type: 'bearer' })
  it('paginates complete organization counts, distinguishes healthy, missing ADMIN and pending, and searches literally', async () => {
    const admin = await context.prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', organizationId: null } })
    const healthy = await context.prisma.organization.create({ data: { name: 'Healthy', slug: 'healthy', members: { create: { userId: fixture.operatorId, roles: { create: { roleId: admin.id } } } } } })
    const first = await fixture.create(fixture.input({ name: 'North 100%', slug: 'north-first' })).expect(201)
    await fixture.create(fixture.input({ name: 'South', slug: 'south-second', firstAdminEmail: 'south@e2e.amcore.test' })).expect(201)
    const one = await get('attention?page=1&limit=1').expect(200)
    const two = await get('attention?page=2&limit=1').expect(200)
    expect(one.body).toMatchObject({ total: 2, organizationTotal: 3, limit: 1 })
    expect(two.body.data).toHaveLength(1)
    expect(one.body.data[0].organizationId).not.toBe(two.body.data[0].organizationId)
    expect(JSON.stringify([one.body, two.body])).not.toContain(healthy.id)
    expect((await get('attention?search=%25').expect(200)).body.data[0].organizationId).toBe(first.body.organizationId)
    await fixture.recover(first.body.organizationId, 'cancel', { operationId: createInvitationOperationId(), expectedRevision: 1 }).expect(200)
    const cancelled = (await get('attention').expect(200)).body.data.find((row: { organizationId: string }) => row.organizationId === first.body.organizationId)
    expect(cancelled).toMatchObject({ adminCount: 0, pendingAdminInvitationCount: 0, reasons: ['no_administrator'] })
  })
  it('keeps expired and pruned awaiting counts but removes terminal additional intents after retention', async () => {
    const created = await fixture.create().expect(201)
    const id = created.body.organizationId
    await fixture.recover(id, 'cancel', { operationId: createInvitationOperationId(), expectedRevision: 1 }).expect(200)
    const operationId = createInvitationOperationId()
    await fixture.http().post(`/admin/organizations/${id}/administrator-invitations`).auth(fixture.token, { type: 'bearer' })
      .send({ operationId, email: 'other@e2e.amcore.test', reason: 'TEST-49 retention' }).expect(201)
    await context.prisma.orgInvite.updateMany({ where: { organizationId: id }, data: { expiresAt: new Date(Date.now() - 31 * 86400000) } })
    await context.app.get(InvitationRetentionService).prune('pending')
    expect((await get('attention').expect(200)).body.data[0].pendingAdminInvitationCount).toBe(1)
    await fixture.http().post(`/admin/organizations/${id}/administrator-invitations/${operationId}/cancel`).auth(fixture.token, { type: 'bearer' })
      .send({ operationId: createInvitationOperationId(), expectedRevision: 2, reason: 'TEST-49 explicit close' }).expect(200)
    expect((await get('attention').expect(200)).body.data[0].pendingAdminInvitationCount).toBe(0)
    const oldOperationId = createInvitationOperationId(Date.now() - 31 * 86400000)
    await context.prisma.organizationAdministratorInvitation.update({ where: { id: operationId }, data: { id: oldOperationId, createdAt: new Date(Date.now() - 31 * 86400000), cancelledAt: new Date(Date.now() - 31 * 86400000) } })
    await context.app.get(InvitationRetentionService).pruneAuxiliary()
    expect(await context.prisma.organizationAdministratorInvitation.count()).toBe(0)
    await fixture.http().post(`/admin/organizations/${id}/administrator-invitations`).auth(fixture.token, { type: 'bearer' })
      .send({ operationId: oldOperationId, email: 'other@e2e.amcore.test', reason: 'TEST-49 retention' }).expect(409)
    const expired = await get(`${id}/administrator-operations/${oldOperationId}`).expect(200)
    expect(expired.body).toEqual({ state: 'unknown', expiredUnrecorded: true })
    const fresh = await get(`${id}/administrator-operations/${createInvitationOperationId()}`).expect(200)
    expect(fresh.body).toEqual({ state: 'unknown', expiredUnrecorded: false })
    // The controlled terminal row and UUID both model elapsed retention; the old identity cannot start again.
  })
  it('fails closed on a corrupt canonical template instead of claiming an empty healthy list', async () => {
    const admin = await context.prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', organizationId: null } })
    await context.prisma.role.update({ where: { id: admin.id }, data: { isSystem: false } })
    try {
      await get('attention').expect(500)
    } finally { await context.prisma.role.update({ where: { id: admin.id }, data: { isSystem: true } }) }
  })
})
