import { createInvitationOperationId } from '@amcore/shared'

import { InvitationRetentionService } from '../../src/core/invitations/invitation-retention.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { CleanupService } from '../../src/infrastructure/schedule/cleanup.service'
import { invitationSeedRole } from '../helpers/invitation-contract'
import { boundedFailure } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

const DAY = 86400000

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
        ...(await invitationSeedRole(prisma, invite.roleIntents[0]?.liveRoleId ?? null)),
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

  it('R13 expired pending remains recoverable for thirty days', async () => {
    const { context, prisma, pending, truth } = getFixture()
    const { invite } = await pending()
    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        expiresAt: new Date(Date.now() - 29 * DAY),
      },
    })
    const before = await truth(invite.id)
    expect(await context.app.get(InvitationRetentionService).prune('pending')).toEqual({ count: 0 })
    expect(await truth(invite.id)).toEqual(before)
    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        expiresAt: new Date(Date.now() - 31 * DAY),
      },
    })
    expect(await context.app.get(InvitationRetentionService).prune('pending')).toEqual({ count: 1 })
    expect((await truth(invite.id)).invite).toBeNull()
    expect((await truth(invite.id)).members).toHaveLength(0)
  })

  it('R13 production cleanup rechecks settlement; logically pruned rows cannot be reissued', async () => {
    const { context, prisma, invites, orgId, actor, pending, truth } = getFixture()
    const { invite } = await pending()
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } })
    // Pause after selection but before cleanup acquires the parent/row locks.
    const original = prisma.$queryRaw.bind(prisma)
    const { deferred } = await import('../helpers/organization-members-race')
    const entered = deferred(),
      release = deferred()
    const selection = jest.spyOn(prisma, '$queryRaw').mockImplementation((async (
      ...args: unknown[]
    ) => {
      const result = await original(...(args as [never]))
      if (String(args[0]).includes('LIMIT 1000')) {
        entered.resolve()
        await Promise.race([release.promise, boundedFailure('Cleanup selection release')])
      }
      return result
    }) as never)
    const cleanup = context.app.get(InvitationRetentionService).prune('pending')
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      await Promise.race([entered.promise, boundedFailure('Cleanup selection')])
      // A logically pruned row cannot be revived by reissue.
      await expect(
        invites.reissueInvite(
          orgId,
          invite.id,
          { mode: 'repeat', expectedGeneration: 1 },
          actor(),
          createInvitationOperationId()
        )
      ).rejects.toMatchObject({ status: 404 })
      // Model a candidate becoming terminal before cleanup's final predicate.
      await prisma.orgInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } })
      release.resolve()
      expect(await cleanup).toEqual({ count: 0 })
      expect((await truth(invite.id)).invite!.revokedAt).not.toBeNull()
    } finally {
      release.resolve()
      selection.mockRestore()
      mail.mockRestore()
      await cleanup
    }
  })
}
