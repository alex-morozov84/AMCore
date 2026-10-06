import { createInvitationOperationId } from '@amcore/shared'
import { type RequestPrincipal } from '@amcore/shared'

import { invitationActor } from '../../src/core/organizations/invitation-actor'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { seedOrgMember } from '../helpers'
import { boundedFailure } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

export function registerTransitionsProofs(getFixture: () => InvitationProofFixture): void {
  it('R01 stale hint cannot accept a rotated issuance', async () => {
    const { context, prisma, invites, orgId, actor, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const original = prisma.orgInvite.findUnique.bind(prisma.orgInvite)
    const entered = (await import('../helpers/organization-members-race')).deferred()
    const release = (await import('../helpers/organization-members-race')).deferred()
    let captured = false
    const hint = jest.spyOn(prisma.orgInvite, 'findUnique').mockImplementation((async (
      args: unknown
    ) => {
      const result = await original(args as never)
      if (!captured) {
        captured = true
        entered.resolve()
        await Promise.race([release.promise, boundedFailure('Hint release')])
      }
      return result
    }) as never)
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    const accepting = outcome(accept(token))
    try {
      await Promise.race([
        entered.promise,
        accepting.then(() => {
          throw new Error('Accept finished before hint')
        }),
        boundedFailure('Hint arrival'),
      ])
      const role = await prisma.role.create({
        data: { name: 'New issuance intent', organizationId: orgId },
      })
      await invites.reissueInvite(
        orgId,
        invite.id,
        { mode: 'replace', expectedGeneration: 1, roleIds: [role.id] },
        actor(),
        createInvitationOperationId()
      )
      const rotated = await truth(invite.id)
      release.resolve()
      expect(await accepting).toBe(400)
      expect(await truth(invite.id)).toEqual(rotated)
      const fresh = new URL(mail.mock.calls[0]![1].acceptUrl).searchParams.get('token')!
      expect(rotated.invite!.roleIntents[0]?.liveRoleId).toBe(role.id)
      expect(await outcome(accept(fresh))).toBe(200)
      const granted = await truth(invite.id)
      expect(granted.members).toHaveLength(1)
      expect(granted.members[0]!.roles.map((r) => r.roleId)).toEqual([role.id])
      expect(granted.audit).toHaveLength(1)
    } finally {
      release.resolve()
      hint.mockRestore()
      mail.mockRestore()
      await accepting
    }
  })

  it.each([true, false])(
    'R05 reissue/revoke fences stale generation; reissue first=%s',
    async (rotationFirst) => {
      const {
        context,
        prisma,
        invites,
        orgId,
        actor,
        pending,
        accept,
        outcome,
        revoked,
        truth,
        race,
      } = getFixture()
      const { invite, token } = await pending()
      const before = await truth(invite.id)
      const rotate = (): ReturnType<typeof invites.reissueInvite> =>
        invites.reissueInvite(
          orgId,
          invite.id,
          { mode: 'repeat', expectedGeneration: 1 },
          actor(),
          createInvitationOperationId()
        )
      const revoke = (generation = 1): ReturnType<typeof invites.revokeInvite> =>
        invites.revokeInvite(orgId, invite.id, generation, actor(), createInvitationOperationId())
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      try {
        expect(
          await race(
            revoked(),
            rotationFirst ? rotate : () => revoke(),
            rotationFirst ? () => revoke() : rotate
          )
        ).toEqual([200, 409])
        const after = await truth(invite.id)
        expect(after.members).toHaveLength(0)
        expect(after.org!.aclVersion).toBe(before.org!.aclVersion)
        expect(after.invite!.generation).toBe(rotationFirst ? 2 : 1)
        expect(after.invite!.revokedAt === null).toBe(rotationFirst)
        expect(await outcome(accept(token))).toBe(400)
        expect(mail).toHaveBeenCalledTimes(rotationFirst ? 1 : 0)
        expect(
          await prisma.auditLog.count({
            where: { action: 'org.invite_reissued', targetId: invite.id },
          })
        ).toBe(rotationFirst ? 1 : 0)
        expect(
          await prisma.auditLog.count({
            where: { action: 'org.invite_revoked', targetId: invite.id },
          })
        ).toBe(rotationFirst ? 0 : 1)
        if (rotationFirst) {
          const fresh = new URL(mail.mock.calls[0]![1].acceptUrl).searchParams.get('token')!
          await revoke(2)
          expect(await outcome(accept(fresh))).toBe(400)
        } else {
          await revoke()
          expect((await truth(invite.id)).invite).toEqual(after.invite)
        }
      } finally {
        mail.mockRestore()
      }
    }
  )

  it('R01 accepted issuance rejects explicit reissue with no second mail', async () => {
    const { context, prisma, invites, orgId, actor, pending, accept, claim, truth, race } =
      getFixture()
    const { token, invite } = await pending()
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      expect(
        await race(
          claim(),
          () => accept(token),
          () =>
            invites.reissueInvite(
              orgId,
              invite.id,
              { mode: 'repeat', expectedGeneration: 1 },
              actor(),
              createInvitationOperationId()
            )
        )
      ).toEqual([200, 409])
      expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(1)
      expect((await truth(invite.id)).audit).toHaveLength(1)
      expect(mail).not.toHaveBeenCalled()
    } finally {
      mail.mockRestore()
    }
  })

  it('R04 two distinct revokers preserve winner identity', async () => {
    const { prisma, invites, orgId, owner, recipient, actor, pending, revoked, race } = getFixture()
    const { invite } = await pending()
    const admin = await prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', isSystem: true } })
    await seedOrgMember(prisma, { orgId, userId: recipient.sub, roleId: admin.id })
    const other: RequestPrincipal = { ...recipient, organizationId: orgId }
    const otherActor = invitationActor({
      user: other,
      privilegedAdmission: { authenticated: other, principal: other },
    })
    expect(
      await race(
        revoked(),
        () => invites.revokeInvite(orgId, invite.id, 1, actor(), createInvitationOperationId()),
        () => invites.revokeInvite(orgId, invite.id, 1, otherActor, createInvitationOperationId())
      )
    ).toEqual([200, 200])
    expect(
      (await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).revokedById
    ).toBe(owner.sub)
    expect(
      await prisma.auditLog.count({ where: { action: 'org.invite_revoked', targetId: invite.id } })
    ).toBe(1)
  })

  it('R02 duplicate accept: exactly one grant, ACL increment and audit', async () => {
    const { roleId, pending, accept, claim, truth, race } = getFixture()
    const { token, invite } = await pending()
    const before = await truth(invite.id)
    expect(
      await race(
        claim(),
        () => accept(token),
        () => accept(token)
      )
    ).toEqual([200, 400])
    const after = await truth(invite.id)
    expect(after.members).toHaveLength(1)
    expect(after.members[0]!.roles.map((r) => r.roleId)).toEqual([roleId])
    expect(after.org!.aclVersion).toBe(before.org!.aclVersion + 1)
    expect(after.audit).toHaveLength(1)
  })

  it.each([true, false])('R03 accept/revoke first acceptance=%s', async (acceptFirst) => {
    const { prisma, invites, orgId, actor, pending, accept, claim, revoked, truth, race } =
      getFixture()
    const { token, invite } = await pending()
    const revoke = (): ReturnType<typeof invites.revokeInvite> =>
      invites.revokeInvite(orgId, invite.id, 1, actor(), createInvitationOperationId())
    expect(
      await race(
        acceptFirst ? claim() : revoked(),
        acceptFirst ? () => accept(token) : revoke,
        acceptFirst ? revoke : () => accept(token)
      )
    ).toEqual([200, acceptFirst ? 409 : 400])
    expect((await truth(invite.id)).members).toHaveLength(acceptFirst ? 1 : 0)
    expect(
      await prisma.auditLog.count({ where: { action: 'org.invite_revoked', targetId: invite.id } })
    ).toBe(acceptFirst ? 0 : 1)
  })

  it('R04 duplicate revoke preserves first timestamp and actor', async () => {
    const { prisma, invites, orgId, actor, pending, revoked, race } = getFixture()
    const { invite } = await pending()
    const revoke = (): ReturnType<typeof invites.revokeInvite> =>
      invites.revokeInvite(orgId, invite.id, 1, actor(), createInvitationOperationId())
    expect(await race(revoked(), revoke, revoke)).toEqual([200, 200])
    const first = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })
    await revoke()
    expect(await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(first)
    expect(
      await prisma.auditLog.count({ where: { action: 'org.invite_revoked', targetId: invite.id } })
    ).toBe(1)
  })
}
