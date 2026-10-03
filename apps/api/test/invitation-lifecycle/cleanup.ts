import { EmailService } from '../../src/infrastructure/email/email.service'
import { CleanupService } from '../../src/infrastructure/schedule/cleanup.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { databaseClockPast, observeInvitationWait } from '../helpers/invitation-race'
const jest = import.meta.jest

export function registerCleanupProofs(getFixture: () => InvitationProofFixture): void {
  it('R13 production terminal retention removes old history and preserves fresh acceptance', async () => {
    const { context, prisma, pending, accept, truth } = getFixture()
    const { token, invite } = await pending()
    await accept(token)
    const fresh = await truth(invite.id)
    const old = await prisma.orgInvite.create({
      data: {
        organizationId: invite.organizationId,
        email: 'retained@example.test',
        emailCanonical: 'retained@example.test',
        tokenHash: 'obviously-fake-retention-hash',
        roleId: invite.roleId,
        expiresAt: new Date(0),
        revokedAt: new Date(0),
      },
    })
    const result = await context.app.get(CleanupService).runCleanup()
    expect(result.failures).toEqual([])
    expect(result.staleTerminalInvites).toBe(1)
    expect(await prisma.orgInvite.count({ where: { id: old.id } })).toBe(0)
    expect(await truth(invite.id)).toEqual(fresh)
  })

  it('R13 cleanup rechecks accepted flag after real row wait', async () => {
    const { prisma, pool, pending, accept, outcome, claim, truth } = getFixture()
    const { token, invite } = await pending()
    const expiry = new Date(Date.now() + 500)
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: expiry } })
    const fence = claim()
    const accepting = outcome(accept(token))
    let cleanup: Promise<unknown> | undefined
    try {
      await fence.entered
      await databaseClockPast(pool, expiry)
      cleanup = prisma.orgInvite
        .deleteMany({
          where: {
            expiresAt: { lt: new Date(expiry.getTime() + 1) },
            acceptedAt: null,
            revokedAt: null,
          },
        })
        .then((value) => value)
      await observeInvitationWait(pool, fence.pid(), 'DELETE')
      fence.release()
      expect(await accepting).toBe(200)
      await cleanup
      expect((await truth(invite.id)).invite!.acceptedAt).not.toBeNull()
    } finally {
      fence.restore()
      await Promise.allSettled([accepting, ...(cleanup ? [cleanup] : [])])
    }
  })

  it('R13 cleanup deletes first; reissue safely inserts after vanished hint', async () => {
    const { context, prisma, pool, invites, orgId, recipient, actor, pending, outcome } =
      getFixture()
    const { invite } = await pending()
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } })
    const client = await pool.connect()
    await client.query('BEGIN')
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await client.query(
      'DELETE FROM core.org_invites WHERE id=$1 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" < CURRENT_TIMESTAMP',
      [invite.id]
    )
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    const creating = outcome(invites.createInvite(orgId, { email: recipient.email! }, actor()))
    try {
      await observeInvitationWait(pool, pid, 'core.org_invites')
      await client.query('COMMIT')
      expect(await creating).toBe(200)
      expect(await prisma.orgInvite.count({ where: { id: invite.id } })).toBe(0)
      expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(1)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      mail.mockRestore()
      await creating
    }
  })

  it('R13 rotation first makes cleanup predicate recheck preserve live invitation', async () => {
    const { context, prisma, pool, invites, orgId, recipient, actor, pending, outcome, revoked } =
      getFixture()
    const { invite } = await pending()
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } })
    const fence = revoked()
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    const creating = outcome(invites.createInvite(orgId, { email: recipient.email! }, actor()))
    let cleanup: Promise<unknown> | undefined
    try {
      await fence.entered
      cleanup = prisma.orgInvite
        .deleteMany({ where: { expiresAt: { lt: new Date() }, acceptedAt: null, revokedAt: null } })
        .then((v) => v)
      await observeInvitationWait(pool, fence.pid(), 'DELETE')
      fence.release()
      expect(await creating).toBe(200)
      await cleanup
      expect(await prisma.orgInvite.count({ where: { id: invite.id } })).toBe(1)
    } finally {
      fence.restore()
      mail.mockRestore()
      await Promise.allSettled([creating, ...(cleanup ? [cleanup] : [])])
    }
  })
}
