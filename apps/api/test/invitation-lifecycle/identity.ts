import { UserCacheService } from '../../src/core/auth/user-cache.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { invitationFence, observeInvitationWait } from '../helpers/invitation-race'
const jest = import.meta.jest

export function registerIdentityProofs(getFixture: () => InvitationProofFixture): void {
  it('R08 original inviter deletion waits invite FK, acceptance never locks inviter', async () => {
    const { pool, owner, pending, accept, outcome, claim, truth } = getFixture()
    const { token, invite } = await pending()
    const fence = claim()
    const accepting = outcome(accept(token))
    let deletion: Promise<unknown> | undefined
    try {
      await fence.entered
      deletion = pool.query('DELETE FROM core.users WHERE id=$1', [owner.sub])
      await observeInvitationWait(pool, fence.pid(), 'DELETE FROM core.users')
      fence.release()
      expect(await accepting).toBe(200)
      await deletion
      expect((await truth(invite.id)).invite!.invitedById).toBeNull()
    } finally {
      fence.restore()
      await Promise.allSettled([accepting, ...(deletion ? [deletion] : [])])
    }
  })

  it.each(['create', 'revoke', 'accept'] as const)(
    'R08 actor DELETE first fences %s identity',
    async (operation) => {
      const { pool, invites, orgId, owner, recipient, actor, pending, accept, outcome, truth } =
        getFixture()
      const { token, invite } = await pending()
      const client = await pool.connect()
      await client.query('BEGIN')
      const id = operation === 'accept' ? recipient.sub : owner.sub
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await client.query('DELETE FROM core.users WHERE id=$1', [id])
      const work =
        operation === 'accept'
          ? accept(token)
          : operation === 'revoke'
            ? invites.revokeInvite(orgId, invite.id, actor())
            : invites.createInvite(orgId, { email: recipient.email! }, actor())
      const result = outcome(work)
      try {
        await observeInvitationWait(pool, pid, 'core.users')
        await client.query('COMMIT')
        expect(await result).toBe(operation === 'accept' ? 400 : 401)
        expect((await truth(invite.id)).invite!.acceptedAt).toBeNull()
        expect((await truth(invite.id)).invite!.revokedAt).toBeNull()
      } finally {
        await client.query('ROLLBACK')
        client.release()
        await result
      }
    }
  )

  it('R09 current identity UPDATE waits recipient SHARE until acceptance commits', async () => {
    const { pool, recipient, pending, accept, outcome, claim } = getFixture()
    const { token } = await pending()
    const fence = claim()
    const accepting = outcome(accept(token))
    let updating: Promise<unknown> | undefined
    try {
      await fence.entered
      updating = pool.query(
        'UPDATE core.users SET "emailVerified"=false,"emailCanonical"=$2 WHERE id=$1',
        [recipient.sub, 'changed@example.test']
      )
      await observeInvitationWait(pool, fence.pid(), 'UPDATE core.users')
      fence.release()
      expect(await accepting).toBe(200)
      await updating
    } finally {
      fence.restore()
      await Promise.allSettled([accepting, ...(updating ? [updating] : [])])
    }
  })

  it.each(['create', 'revoke', 'accept'] as const)(
    'R08 operation first makes actor DELETE wait, %s',
    async (operation) => {
      const {
        context,
        prisma,
        pool,
        invites,
        orgId,
        owner,
        recipient,
        actor,
        pending,
        accept,
        outcome,
        claim,
        revoked,
      } = getFixture()
      const { token, invite } = await pending()
      const fence =
        operation === 'accept'
          ? claim()
          : operation === 'revoke'
            ? revoked()
            : invitationFence(
                prisma,
                (model, method) => model === 'orgInvite' && method === 'update'
              )
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      const work =
        operation === 'accept'
          ? accept(token)
          : operation === 'revoke'
            ? invites.revokeInvite(orgId, invite.id, actor())
            : invites.createInvite(orgId, { email: recipient.email! }, actor())
      const result = outcome(work)
      let deletion: Promise<unknown> | undefined
      try {
        await fence.entered
        deletion = pool.query('DELETE FROM core.users WHERE id=$1', [
          operation === 'accept' ? recipient.sub : owner.sub,
        ])
        await observeInvitationWait(pool, fence.pid(), 'DELETE FROM core.users')
        fence.release()
        expect(await result).toBe(200)
        await deletion
        expect(await prisma.orgInvite.count({ where: { id: invite.id } })).toBe(1)
      } finally {
        fence.restore()
        mail.mockRestore()
        await Promise.allSettled([result, ...(deletion ? [deletion] : [])])
      }
    }
  )

  it.each(['expired', 'revoked', 'mismatch', 'deleted-role'] as const)(
    'R09 unverified identity does not distinguish unusable %s',
    async (kind) => {
      const { prisma, recipient, roleId, pending, accept, outcome, truth } = getFixture()
      const { token, invite } = await pending(kind === 'deleted-role' ? null : roleId)
      await prisma.user.update({
        where: { id: recipient.sub },
        data: {
          emailVerified: false,
          ...(kind === 'mismatch' && { emailCanonical: 'other@example.test' }),
        },
      })
      await prisma.orgInvite.update({
        where: { id: invite.id },
        data: {
          ...(kind === 'expired' && { expiresAt: new Date(0) }),
          ...(kind === 'revoked' && { revokedAt: new Date() }),
        },
      })
      expect(await outcome(accept(token))).toBe(400)
      expect((await truth(invite.id)).members).toEqual([])
    }
  )

  it('R09 primary identity overrides cached credential email and verification', async () => {
    const { context, prisma, recipient, pending, accept, outcome } = getFixture()
    const { token } = await pending()
    await context.app.get(UserCacheService).getUser(recipient.sub)
    await prisma.user.update({
      where: { id: recipient.sub },
      data: { emailCanonical: 'changed@example.test' },
    })
    expect(await outcome(accept(token))).toBe(400)
    await prisma.user.update({
      where: { id: recipient.sub },
      data: { emailCanonical: recipient.email!, emailVerified: false },
    })
    expect(await outcome(accept(token))).toBe(403)
    expect(await outcome(accept('missing'))).toBe(400)
  })
}
