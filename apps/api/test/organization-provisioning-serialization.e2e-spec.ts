import { scheduler } from 'node:timers/promises'

import { createInvitationOperationId } from '@amcore/shared'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('Provisioning recipient serialization (e2e)', () => {
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
  })

  async function waitForBlockedOrganization(blocker: number) {
    const deadline = Date.now() + 1000
    while (Date.now() < deadline) {
      const [row] = await context.prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE ${blocker} = ANY(pg_blocking_pids(pid))
          AND query LIKE '%core.organizations%') AS waiting`
      if (row?.waiting) return
      await scheduler.yield()
    }
    throw new Error('Expected organization waiter on the selected transaction')
  }

  for (const action of ['replace-recipient', 'cancel'] as const) {
    it.each([true, false])(
      `serializes accept with ${action}; acceptance first=%s`,
      async (acceptFirst) => {
        const created = await fixture.create().expect(201)
        const actor = await prepareProvisioningRecipient(context, fixture)
        const fence = invitationFence(
          context.prisma,
          (model, method) => model === 'organizationProvisioning' && method === 'update'
        )
        const recovery = () =>
          fixture
            .recover(created.body.organizationId, action, {
              operationId: createInvitationOperationId(),
              expectedRevision: 1,
              ...(action === 'replace-recipient'
                ? { firstAdminEmail: 'replacement@e2e.amcore.test' }
                : {}),
            })
            .then((response) => response)
        let first: ReturnType<typeof recovery> | undefined
        let second: ReturnType<typeof recovery> | undefined
        try {
          first = acceptFirst ? actor.accept().then((response) => response) : recovery()
          await fence.waitFor(first)
          second = acceptFirst ? recovery() : actor.accept().then((response) => response)
          await waitForBlockedOrganization(fence.pid())
          fence.release()
          expect((await first).status).toBe(200)
          expect((await second).status).toBe(acceptFirst ? 409 : 400)
          const row = await context.prisma.organizationProvisioning.findFirstOrThrow()
          expect(row.state).toBe(
            acceptFirst ? 'completed' : action === 'cancel' ? 'cancelled' : 'awaiting'
          )
          expect(await context.prisma.orgMember.count({ where: { userId: actor.id } })).toBe(
            acceptFirst ? 1 : 0
          )
          expect(
            await context.prisma.auditLog.count({
              where: {
                action: 'org.provisioning_completed',
                organizationId: created.body.organizationId,
              },
            })
          ).toBe(acceptFirst ? 1 : 0)
          expect(row.originalAdminUserId).toBe(acceptFirst ? actor.id : null)
          const progress = await fixture.status(created.body.organizationId).expect(200)
          expect(progress.body.invite?.email ?? null).toBe(
            !acceptFirst && action === 'replace-recipient' ? 'replacement@e2e.amcore.test' : null
          )
        } finally {
          fence.restore()
          await Promise.allSettled([first, second])
        }
      }
    )
  }
})
