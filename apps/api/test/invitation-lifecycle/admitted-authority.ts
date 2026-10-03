import { Action, Subject, SystemRole } from '@amcore/shared'

import { ApiKeyRevocationService } from '../../src/core/api-keys/api-key-revocation.service'
import { ApiKeysService } from '../../src/core/api-keys/api-keys.service'
import { MemberService } from '../../src/core/organizations/member.service'
import { RoleService } from '../../src/core/organizations/role.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { seedOrgMember } from '../helpers'
import { afterInvitationAdmission, invitationHttp, invitationJwt } from '../helpers/invitation-http'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { databaseClockPast, observeInvitationWait } from '../helpers/invitation-race'
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

  it.each(['delete', 'revoke', 'membership', 'deny', 'super-membership', 'super-scope'] as const)(
    'F2/R11 real crypto admission followed by %s fails closed for the exact key',
    async (loss) => {
      const f = getFixture()
      const { context, prisma, owner, orgId, invites, pending, truth } = f
      await secondAdmin(f)
      if (loss.startsWith('super'))
        await prisma.user.update({
          where: { id: owner.sub },
          data: { systemRole: SystemRole.SuperAdmin },
        })
      const key = await context.app.get(ApiKeysService).create(owner.sub, {
        name: 'Exact real admission',
        organizationId: orgId,
        scopes: ['manage:TeamAccess'],
      })
      await context.app.get(ApiKeysService).create(owner.sub, {
        name: 'Cannot substitute',
        organizationId: orgId,
        scopes: ['manage:TeamAccess'],
      })
      const { invite } = await pending()
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      let baseline: Awaited<ReturnType<typeof truth>> | undefined
      try {
        const response = await afterInvitationAdmission(
          invites,
          'createInvite',
          () => invitationHttp(f, key.key, 'create', invite.id),
          async () => {
            if (loss === 'delete') await prisma.apiKey.delete({ where: { id: key.id } })
            else if (loss === 'revoke')
              await context.app.get(ApiKeyRevocationService).revoke([key.id], owner.sub, false)
            else if (loss.includes('membership'))
              await context.app.get(MemberService).removeMember(orgId, owner.sub, owner)
            else if (loss === 'super-scope')
              await prisma.apiKey.update({ where: { id: key.id }, data: { scopes: ['read:Role'] } })
            else {
              const roles = context.app.get(RoleService)
              const role = await roles.createRole(orgId, { name: 'Late owner veto' }, owner)
              await roles.assignPermission(
                orgId,
                role.id,
                {
                  action: Action.Read,
                  subject: Subject.Role,
                  inverted: true,
                  fields: ['name'],
                  conditions: { id: 'unmatched' },
                },
                owner
              )
              await context.app.get(MemberService).assignRole(orgId, owner.sub, role.id, owner)
            }
            baseline = await truth(invite.id)
          }
        )
        expect(response.status).toBe(['delete', 'revoke', 'super-scope'].includes(loss) ? 401 : 403)
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
  it('F2/R11 real admitted key expires after the exact invite-row wait', async () => {
    const f = getFixture()
    const { context, prisma, pool, owner, orgId, invites, pending, truth } = f
    const { invite } = await pending()
    const key = await context.app.get(ApiKeysService).create(owner.sub, {
      name: 'Row wait expiry',
      organizationId: orgId,
      scopes: ['manage:TeamAccess'],
    })
    const client = await pool.connect()
    let pid = 0
    let expiry = new Date()
    let before: Awaited<ReturnType<typeof truth>> | undefined
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      const response = await afterInvitationAdmission(
        invites,
        'createInvite',
        () => invitationHttp(f, key.key, 'create', invite.id),
        async () => {
          expiry = new Date(Date.now() + 400)
          await prisma.apiKey.update({ where: { id: key.id }, data: { expiresAt: expiry } })
          before = await truth(invite.id)
          await client.query('BEGIN')
          pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
          await client.query('SELECT id FROM core.org_invites WHERE id=$1 FOR UPDATE', [invite.id])
        },
        async (operation) => {
          await observeInvitationWait(pool, operation, pid, 'core.org_invites')
          await databaseClockPast(pool, expiry)
          await client.query('COMMIT')
        }
      )
      expect(response.status).toBe(401)
      expect(await truth(invite.id)).toEqual(before)
      expect(
        await prisma.auditLog.count({
          where: { action: 'org.invite_created', organizationId: orgId },
        })
      ).toBe(0)
      expect(mail).not.toHaveBeenCalled()
    } finally {
      await client.query('ROLLBACK')
      client.release()
      mail.mockRestore()
    }
  })
}
