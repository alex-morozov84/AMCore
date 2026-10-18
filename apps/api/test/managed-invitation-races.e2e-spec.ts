import { scheduler } from 'node:timers/promises'

import { createInvitationOperationId } from '@amcore/shared'

import { InviteRateLimiterService } from '../src/core/organizations/invite-rate-limiter.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareManagedInvitation } from './managed-invitation-fixture'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('Managed owner serial orders against ordinary writers (e2e)', () => {
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
  async function blocked(blocker: number) {
    const deadline = Date.now() + 1000
    while (Date.now() < deadline) {
      const [row] = await context.prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${blocker}=ANY(pg_blocking_pids(pid)) AND query LIKE '%core.organizations%') AS waiting`
      if (row?.waiting) return
      await scheduler.yield()
    }
    throw new Error('Expected exact parent-row waiter')
  }
  for (const kind of ['initial', 'additional'] as const)
    for (const platformAction of ['replace-recipient', 'cancel', 'accept'] as const)
      for (const ordinaryAction of ['create', 'repeat', 'replace', 'revoke'] as const)
        it.each([true, false])(
          `${kind}: ${ordinaryAction} versus ${platformAction}; ordinary first=%s`,
          async (ordinaryFirst) => {
            const { orgId, token, current, roleId } = await prepareManagedInvitation(
              context,
              fixture,
              kind
            )
            const recipient =
              platformAction === 'accept'
                ? await prepareProvisioningRecipient(context, fixture)
                : undefined
            const intent =
              kind === 'additional'
                ? await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()
                : undefined
            const root = `/organizations/${orgId}/invites`
            const ordinary = () => {
              const request =
                ordinaryAction === 'create'
                  ? fixture
                      .http()
                      .post(root)
                      .send({ email: current.emailCanonical, roleIds: [roleId] })
                  : ordinaryAction === 'revoke'
                    ? fixture.http().delete(`${root}/${current.id}?expectedGeneration=1`)
                    : fixture
                        .http()
                        .post(`${root}/${current.id}/reissue`)
                        .send({
                          expectedGeneration: 1,
                          mode: ordinaryAction,
                          ...(ordinaryAction === 'replace' ? { roleIds: [roleId] } : {}),
                        })
              return request
                .auth(token, { type: 'bearer' })
                .set('X-Invitation-Operation-Id', createInvitationOperationId())
                .then((res) => res)
            }
            const platform = () => {
              if (recipient) return recipient.accept().then((res) => res)
              const body = {
                operationId: createInvitationOperationId(),
                expectedRevision: 1,
                ...(platformAction === 'replace-recipient'
                  ? kind === 'initial'
                    ? { firstAdminEmail: 'replacement@e2e.amcore.test' }
                    : { email: 'replacement@e2e.amcore.test' }
                  : {}),
              }
              return kind === 'initial'
                ? fixture.recover(orgId, platformAction, body).then((res) => res)
                : fixture
                    .http()
                    .post(
                      `/admin/organizations/${orgId}/administrator-invitations/${intent!.id}/${platformAction}`
                    )
                    .auth(fixture.token, { type: 'bearer' })
                    .send({ ...body, reason: 'TEST-49 serialized action' })
                    .then((res) => res)
            }
            const quota = import.meta.jest.spyOn(
              context.app.get(InviteRateLimiterService),
              'consume'
            )
            const fence = invitationFence(context.prisma, (model, method, args) =>
              ordinaryFirst
                ? model === '$sql' &&
                  method === '$queryRaw' &&
                  String(args[0]).includes('SELECT p.*, i.generation')
                : model ===
                    (kind === 'initial'
                      ? 'organizationProvisioning'
                      : 'organizationAdministratorInvitation') && method === 'update'
            )
            let first: ReturnType<typeof ordinary> | undefined
            let second: ReturnType<typeof ordinary> | undefined
            try {
              first = ordinaryFirst ? ordinary() : platform()
              await fence.waitFor(first)
              second = ordinaryFirst ? platform() : ordinary()
              await blocked(fence.pid())
              fence.release()
              const [a, b] = await Promise.all([first, second])
              const platformResult = ordinaryFirst ? b : a
              const ordinaryResult = ordinaryFirst ? a : b
              expect(platformResult.status).toBe(200)
              const expectedStatus = ordinaryFirst
                ? 409
                : ordinaryAction === 'create'
                  ? 202
                  : ordinaryAction === 'revoke' && platformAction !== 'accept'
                    ? 204
                    : 409
              expect(ordinaryResult.status).toBe(expectedStatus)
              expect(ordinaryFirst ? ordinaryResult.body.errorCode : undefined).toBe(
                ordinaryFirst ? 'PROVISIONING_MANAGED' : undefined
              )
              expect(quota.mock.calls.length).toBe(
                !ordinaryFirst && ordinaryAction === 'create' ? 1 : 0
              )
              const row =
                kind === 'initial'
                  ? await context.prisma.organizationProvisioning.findFirstOrThrow()
                  : await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()
              expect(row.state).toBe(
                platformAction === 'accept'
                  ? 'completed'
                  : platformAction === 'cancel'
                    ? 'cancelled'
                    : 'awaiting'
              )
              const old = await context.prisma.orgInvite.findUniqueOrThrow({
                where: { id: current.id },
                include: { roleIntents: true },
              })
              expect(old.generation).toBe(1)
              expect(old.roleIntents).toHaveLength(1)
              expect(old.roleIntents[0]!.roleNameAtIssue).toBe('ADMIN')
            } finally {
              fence.restore()
              await Promise.allSettled([first, second])
            }
          }
        )
})
