import { Action, Subject } from '@amcore/shared'

import { MemberService } from '../../src/core/organizations/member.service'
import { RoleService } from '../../src/core/organizations/role.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { seedOrgMember } from '../helpers'
import { afterInvitationAdmission, invitationHttp, invitationJwt } from '../helpers/invitation-http'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

async function secondAdmin(f: InvitationProofFixture): Promise<void> {
  const user = await f.prisma.user.create({
    data: {
      email: 'other-admin@example.test',
      emailCanonical: 'other-admin@example.test',
      emailVerified: true,
    },
  })
  const admin = await f.prisma.role.findFirstOrThrow({ where: { isSystem: true, name: 'ADMIN' } })
  await seedOrgMember(f.prisma, { orgId: f.orgId, userId: user.id, roleId: admin.id })
}

export function registerAdmittedAuthorityProofs(getFixture: () => InvitationProofFixture): void {
  describe.each(['create', 'revoke'] as const)('F2/R10 real guard %s', (operation) => {
    it.each(['membership', 'role', 'permission'] as const)(
      'supported %s loss after admission denies without invitation effects',
      async (loss) => {
        const f = getFixture()
        const { context, prisma, orgId, owner, invites, pending, truth } = f
        await secondAdmin(f)
        const roles = context.app.get(RoleService)
        let roleId = ''
        let permissionId = ''
        if (loss !== 'membership') {
          const role = await roles.createRole(orgId, { name: 'Admitted manager' }, owner)
          roleId = role.id
          permissionId = (
            await roles.assignPermission(
              orgId,
              roleId,
              { action: Action.Manage, subject: Subject.TeamAccess },
              owner
            )
          ).id
          const member = await prisma.orgMember.findUniqueOrThrow({
            where: { userId_organizationId: { userId: owner.sub, organizationId: orgId } },
          })
          await prisma.memberRole.deleteMany({ where: { memberId: member.id } })
          await prisma.memberRole.create({ data: { memberId: member.id, roleId } })
        }
        const { invite } = await pending()
        const jwt = await invitationJwt(f)
        const mail = jest
          .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
          .mockResolvedValue(undefined)
        let baseline: Awaited<ReturnType<typeof truth>> | undefined
        try {
          const response = await afterInvitationAdmission(
            invites,
            operation === 'create' ? 'createInvite' : 'revokeInvite',
            () => invitationHttp(f, jwt, operation, invite.id),
            async () => {
              if (loss === 'membership')
                await context.app.get(MemberService).removeMember(orgId, owner.sub, owner)
              else if (loss === 'role') await roles.deleteRole(orgId, roleId, owner)
              else await roles.removePermission(orgId, roleId, permissionId, owner)
              baseline = await truth(invite.id)
            }
          )
          expect(response.status).toBe(403)
          expect(await truth(invite.id)).toEqual(baseline)
          expect(
            await prisma.auditLog.count({
              where: {
                action: { in: ['org.invite_created', 'org.invite_revoked'] },
                organizationId: orgId,
              },
            })
          ).toBe(0)
          expect(mail).not.toHaveBeenCalled()
        } finally {
          mail.mockRestore()
        }
      }
    )
  })

  it('F2 HTTP barrier teardown awaits actual work when an observer refuses after resume', async () => {
    const f = getFixture()
    const { context, prisma, orgId, invites } = f
    const invite = { id: 'new-invitation' }
    const jwt = await invitationJwt(f)
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    let completed = false
    try {
      const response = await afterInvitationAdmission(
        invites,
        'createInvite',
        () => invitationHttp(f, jwt, 'create', invite.id),
        async () => undefined,
        async (operation) => {
          void operation
            .finally(() => {
              completed = true
            })
            .catch(() => undefined)
          throw new Error('Injected observation refusal')
        }
      )
      expect(response.status).toBe(500)
      expect(completed).toBe(true)
      expect(
        await prisma.auditLog.count({
          where: { action: 'org.invite_created', organizationId: orgId },
        })
      ).toBe(1)
      expect(mail).toHaveBeenCalledTimes(1)
    } finally {
      mail.mockRestore()
    }
  })
}
