import { createInvitationOperationId } from '@amcore/shared'

import { InvitationRetentionService } from '../../src/core/invitations/invitation-retention.service'
import { InviteAcceptService } from '../../src/core/organizations/invite-accept.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'

export function registerReceiptProofs(getFixture: () => InvitationProofFixture): void {
  it('R17 stable acceptance intent replays after consume, expiry and invitation pruning', async () => {
    const { context, prisma, invites, pending, recipient, truth } = getFixture()
    const { token, invite } = await pending()
    const operationId = createInvitationOperationId()
    const intent = { expectedInviteId: invite.id, expectedGeneration: invite.generation }
    const accepted = await invites.acceptInvite(
      { token },
      intent,
      operationId,
      recipient,
      '127.0.0.1'
    )
    const before = await truth(invite.id)
    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        expiresAt: new Date(0),
        acceptedAt: new Date(0),
      },
    })
    expect(await context.app.get(InvitationRetentionService).prune('terminal')).toEqual({
      count: 1,
    })
    expect(
      await invites.acceptInvite(
        { token: 'discarded-credential' },
        intent,
        operationId,
        recipient,
        '127.0.0.1'
      )
    ).toEqual(accepted)
    const recovery = await context.app.get(InviteAcceptService).operation(operationId, recipient)
    expect(recovery).toEqual({ state: 'committed', intent, result: accepted, access: 'present' })
    const after = await truth(invite.id)
    expect(after.members).toEqual(before.members)
    expect(after.org).toEqual(before.org)
    expect(after.audit).toEqual(before.audit)
    await prisma.orgMember.deleteMany({ where: { userId: recipient.sub } })
    expect(await context.app.get(InviteAcceptService).operation(operationId, recipient)).toEqual({
      ...recovery,
      access: 'removed',
    })
    expect(
      await invites.acceptInvite({ token }, intent, operationId, recipient, '127.0.0.1')
    ).toEqual(accepted)
    expect(await prisma.orgMember.count({ where: { userId: recipient.sub } })).toBe(0)
    await expect(
      invites.acceptInvite(
        { token },
        { ...intent, expectedInviteId: 'other-target' },
        operationId,
        recipient,
        '127.0.0.1'
      )
    ).rejects.toMatchObject({ errorCode: 'INVITE_OPERATION_CONFLICT' })
  })

  it('R17 missing aged acceptance operation never executes against a new target', async () => {
    const { prisma, invites, pending, recipient } = getFixture()
    const { token, invite } = await pending()
    const operationId = createInvitationOperationId(Date.now() - 31 * 86400000)
    await expect(
      invites.acceptInvite(
        { token },
        {
          expectedInviteId: invite.id,
          expectedGeneration: invite.generation,
        },
        operationId,
        recipient,
        '127.0.0.1'
      )
    ).rejects.toMatchObject({ errorCode: 'INVITE_OPERATION_EXPIRED' })
    expect(await prisma.orgMember.count({ where: { userId: recipient.sub } })).toBe(0)
    expect(
      (await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedAt
    ).toBeNull()
  })
}
