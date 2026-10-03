import { createHash } from 'node:crypto'

import { type RequestPrincipal } from '@amcore/shared'

import { invitationActor } from '../../src/core/organizations/invitation-actor'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { seedOrgMember } from '../helpers'
import { boundedFailure } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

export function registerTransitionsProofs(getFixture: () => InvitationProofFixture): void {
  it('R01 stale hint cannot accept a rotated issuance', async () => {
    const { context, prisma, invites, orgId, recipient, actor, pending, accept, outcome, truth } =
      getFixture()
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
      await invites.createInvite(orgId, { email: recipient.email!, roleId: role.id }, actor())
      const rotated = await truth(invite.id)
      release.resolve()
      expect(await accepting).toBe(400)
      expect(await truth(invite.id)).toEqual(rotated)
      const fresh = new URL(mail.mock.calls[0]![1].acceptUrl).searchParams.get('token')!
      expect(rotated.invite!.roleId).toBe(role.id)
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

  it.each([true, false])('R05 rotation/revoke rotation first=%s', async (rotationFirst) => {
    const {
      context,
      prisma,
      invites,
      orgId,
      recipient,
      actor,
      pending,
      accept,
      outcome,
      revoked,
      truth,
      owner,
      race,
    } = getFixture()
    const { invite, token } = await pending()
    const before = await truth(invite.id)
    const rotate = (): ReturnType<typeof invites.createInvite> =>
      invites.createInvite(orgId, { email: recipient.email! }, actor())
    const revoke = (): ReturnType<typeof invites.revokeInvite> =>
      invites.revokeInvite(orgId, invite.id, actor())
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      expect(
        await race(revoked(), rotationFirst ? rotate : revoke, rotationFirst ? revoke : rotate)
      ).toEqual([200, 200])
      const terminal = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })
      expect(terminal.revokedById).toBe(owner.sub)
      expect(terminal.revokedAt).not.toBeNull()
      expect(terminal.acceptedAt).toBeNull()
      expect(terminal.acceptedByUserId).toBeNull()
      if (!rotationFirst)
        expect(terminal).toEqual({
          ...invite,
          revokedAt: terminal.revokedAt,
          revokedById: owner.sub,
          updatedAt: terminal.updatedAt,
        })
      expect(
        await prisma.auditLog.count({
          where: { action: 'org.invite_revoked', targetId: invite.id },
        })
      ).toBe(1)
      await revoke()
      expect(await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(
        terminal
      )
      expect(await outcome(accept(token))).toBe(400)
      const fresh = new URL(mail.mock.calls[0]![1].acceptUrl).searchParams.get('token')!
      const newHash = createHash('sha256').update(fresh).digest('hex')
      const issued = await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: newHash } })
      expect(terminal.tokenHash).toBe(rotationFirst ? newHash : invite.tokenHash)
      expect(terminal).toMatchObject({
        id: invite.id,
        organizationId: orgId,
        emailCanonical: invite.emailCanonical,
        roleId: invite.roleId,
        invitedById: owner.sub,
        createdAt: invite.createdAt,
      })
      const revocation = await prisma.auditLog.findMany({
        where: { action: 'org.invite_revoked', targetId: invite.id },
      })
      expect(revocation).toEqual([
        expect.objectContaining({
          actorId: owner.sub,
          organizationId: orgId,
          targetId: invite.id,
          metadata: { actorCredentialType: 'jwt', pinoEvent: 'org.invite.revoked' },
        }),
      ])
      const issuance = await prisma.auditLog.findMany({
        where: { action: 'org.invite_created', organizationId: orgId },
      })
      expect(issuance).toEqual([
        expect.objectContaining({
          actorId: owner.sub,
          targetId: issued.id,
          metadata: expect.objectContaining({
            roleId: invite.roleId,
            branch: rotationFirst ? 'rotated_existing' : 'pending_known_user',
          }),
        }),
      ])
      expect(await outcome(accept(fresh))).toBe(rotationFirst ? 400 : 200)
      expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(
        rotationFirst ? 1 : 2
      )
      expect(await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(
        terminal
      )
      expect(
        await prisma.auditLog.count({
          where: { action: 'org.invite_created', organizationId: orgId },
        })
      ).toBe(1)
      expect(
        await prisma.auditLog.count({
          where: { action: 'org.invite_accepted', organizationId: orgId },
        })
      ).toBe(rotationFirst ? 0 : 1)
      const after = await truth(invite.id)
      expect(after.org!.aclVersion).toBe(before.org!.aclVersion + (rotationFirst ? 0 : 1))
      expect(after.members).toHaveLength(rotationFirst ? 0 : 1)
    } finally {
      mail.mockRestore()
    }
  })

  it('R01 accepted issuance first turns reissue into no-op with no second mail', async () => {
    const {
      context,
      prisma,
      invites,
      orgId,
      recipient,
      actor,
      pending,
      accept,
      claim,
      truth,
      race,
    } = getFixture()
    const { token, invite } = await pending()
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      expect(
        await race(
          claim(),
          () => accept(token),
          () => invites.createInvite(orgId, { email: recipient.email! }, actor())
        )
      ).toEqual([200, 200])
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
        () => invites.revokeInvite(orgId, invite.id, actor()),
        () => invites.revokeInvite(orgId, invite.id, otherActor)
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
      invites.revokeInvite(orgId, invite.id, actor())
    expect(
      await race(
        acceptFirst ? claim() : revoked(),
        acceptFirst ? () => accept(token) : revoke,
        acceptFirst ? revoke : () => accept(token)
      )
    ).toEqual([200, 400])
    expect((await truth(invite.id)).members).toHaveLength(acceptFirst ? 1 : 0)
    expect(
      await prisma.auditLog.count({ where: { action: 'org.invite_revoked', targetId: invite.id } })
    ).toBe(acceptFirst ? 0 : 1)
  })

  it('R04 duplicate revoke preserves first timestamp and actor', async () => {
    const { prisma, invites, orgId, actor, pending, revoked, race } = getFixture()
    const { invite } = await pending()
    const revoke = (): ReturnType<typeof invites.revokeInvite> =>
      invites.revokeInvite(orgId, invite.id, actor())
    expect(await race(revoked(), revoke, revoke)).toEqual([200, 200])
    const first = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })
    await revoke()
    expect(await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(first)
    expect(
      await prisma.auditLog.count({ where: { action: 'org.invite_revoked', targetId: invite.id } })
    ).toBe(1)
  })
}
