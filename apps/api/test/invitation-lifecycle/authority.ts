import request from 'supertest'

import { createInvitationOperationId } from '@amcore/shared'
import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { registerApiKeyAdmission } from '../../src/core/api-keys/api-key-admission'
import { ApiKeyRevocationService } from '../../src/core/api-keys/api-key-revocation.service'
import { ApiKeysService } from '../../src/core/api-keys/api-keys.service'
import { invitationActor } from '../../src/core/organizations/invitation-actor'
import { EmailService } from '../../src/infrastructure/email/email.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

export function registerAuthorityProofs(getFixture: () => InvitationProofFixture): void {
  it('R11 actual key HTTP admission and bearer-only boundaries', async () => {
    const { context, orgId, owner, recipient } = getFixture()
    const key = await context.app
      .get(ApiKeysService)
      .create(owner.sub, { name: 'Proof', organizationId: orgId, scopes: ['manage:TeamAccess'] })
    const server = context.app.getHttpServer()
    await request(server)
      .post(`/organizations/${orgId}/invites`)
      .auth(key.key, { type: 'bearer' })
      .send({ email: recipient.email })
      .expect(401)
    await request(server)
      .get(`/organizations/${orgId}/invites`)
      .auth(key.key, { type: 'bearer' })
      .expect(401)
    await request(server)
      .delete(`/organizations/${orgId}/invites/missing`)
      .auth(key.key, { type: 'bearer' })
      .expect(401)
    await request(server)
      .post('/auth/invites/accept')
      .auth(key.key, { type: 'bearer' })
      .send({ token: 'missing' })
      .expect(401)
  })

  it('R11 exact admitted key revoked after admission cannot be substituted', async () => {
    const { context, prisma, invites, orgId, owner, recipient, outcome } = getFixture()
    const keys = context.app.get(ApiKeysService)
    const old = await keys.create(owner.sub, {
      name: 'Old',
      organizationId: orgId,
      scopes: ['manage:TeamAccess'],
    })
    await keys.create(owner.sub, {
      name: 'Other',
      organizationId: orgId,
      scopes: ['manage:TeamAccess'],
    })
    const principal: RequestPrincipal = { ...owner, type: 'api_key', scopes: ['manage:TeamAccess'] }
    const admitted = {
      user: principal,
      privilegedAdmission: { authenticated: principal, principal },
    }
    registerApiKeyAdmission(admitted, old.id, principal)
    const keyActor = invitationActor(admitted)
    await context.app.get(ApiKeyRevocationService).revoke([old.id], owner.sub, false)
    expect(
      await outcome(
        invites.createInvite(
          orgId,
          { email: recipient.email! },
          keyActor,
          createInvitationOperationId()
        )
      )
    ).toBe(403)
    expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(0)
    expect(() =>
      invitationActor({
        user: principal,
        privilegedAdmission: { authenticated: principal, principal },
      })
    ).toThrow()
  })

  it.each([false, true])(
    'R10 custom Manager authority grant=%s is independent of role name',
    async (grant) => {
      const { context, prisma, invites, orgId, owner, recipient, actor, outcome } = getFixture()
      const member = await prisma.orgMember.findUniqueOrThrow({
        where: { userId_organizationId: { userId: owner.sub, organizationId: orgId } },
      })
      await prisma.memberRole.deleteMany({ where: { memberId: member.id } })
      const manager = await prisma.role.create({ data: { name: 'Manager', organizationId: orgId } })
      await prisma.memberRole.create({ data: { memberId: member.id, roleId: manager.id } })
      if (grant) {
        const permission = await prisma.permission.create({
          data: { action: 'manage', subject: 'TeamAccess', organizationId: orgId },
        })
        await prisma.rolePermission.create({
          data: { roleId: manager.id, permissionId: permission.id },
        })
      }
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      try {
        expect(
          await outcome(
            invites.createInvite(
              orgId,
              { email: recipient.email! },
              actor(),
              createInvitationOperationId()
            )
          )
        ).toBe(grant ? 200 : 403)
      } finally {
        mail.mockRestore()
      }
    }
  )

  it('R10 complete owner DENY vetoes a personal admitted request', async () => {
    const { context, prisma, invites, orgId, owner, recipient, outcome } = getFixture()
    await context.app
      .get(ApiKeysService)
      .create(owner.sub, { name: 'Veto', organizationId: orgId, scopes: ['manage:TeamAccess'] })
    const principal: RequestPrincipal = owner
    const request = {
      user: principal,
      privilegedAdmission: { authenticated: principal, principal },
    }
    const admitted = invitationActor(request)
    const role = await prisma.role.create({
      data: { name: 'Post-admission veto', organizationId: orgId },
    })
    const permission = await prisma.permission.create({
      data: {
        action: 'read',
        subject: 'Role',
        inverted: true,
        fields: ['name'],
        conditions: { id: 'unmatched' },
        organizationId: orgId,
      },
    })
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } })
    const member = await prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId: owner.sub, organizationId: orgId } },
    })
    await prisma.memberRole.create({ data: { memberId: member.id, roleId: role.id } })
    expect(
      await outcome(
        invites.createInvite(
          orgId,
          { email: recipient.email! },
          admitted,
          createInvitationOperationId()
        )
      )
    ).toBe(403)
    expect(await prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(0)
  })

  it('R10 promotion after admission cannot introduce platform bypass', async () => {
    const { prisma, invites, orgId, owner, recipient, actor, outcome } = getFixture()
    const admitted = actor()
    await prisma.memberRole.deleteMany({ where: { member: { userId: owner.sub } } })
    await prisma.user.update({
      where: { id: owner.sub },
      data: { systemRole: SystemRole.SuperAdmin },
    })
    expect(
      await outcome(
        invites.createInvite(
          orgId,
          { email: recipient.email! },
          admitted,
          createInvitationOperationId()
        )
      )
    ).toBe(403)
  })

  it.each([true, false])(
    'R10 demoted admitted platform actor retains independently granted team authority=%s',
    async (hasTeam) => {
      const { context, prisma, invites, orgId, owner, recipient, outcome } = getFixture()
      await prisma.user.update({
        where: { id: owner.sub },
        data: { systemRole: SystemRole.SuperAdmin },
      })
      const privileged: RequestPrincipal = { ...owner, systemRole: SystemRole.SuperAdmin }
      const admitted = invitationActor({
        user: privileged,
        privilegedAdmission: {
          authenticated: privileged,
          principal: privileged,
          currentRole: SystemRole.SuperAdmin,
        },
      })
      await prisma.user.update({ where: { id: owner.sub }, data: { systemRole: SystemRole.User } })
      if (!hasTeam) await prisma.memberRole.deleteMany({ where: { member: { userId: owner.sub } } })
      const mail = jest
        .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
        .mockResolvedValue(undefined)
      try {
        expect(
          await outcome(
            invites.createInvite(
              orgId,
              { email: recipient.email! },
              admitted,
              createInvitationOperationId()
            )
          )
        ).toBe(hasTeam ? 200 : 403)
      } finally {
        mail.mockRestore()
      }
    }
  )

  it('R10 admitted sender losing membership fails inside transaction', async () => {
    const { prisma, invites, orgId, owner, recipient, actor, outcome } = getFixture()
    const admitted = actor()
    await prisma.orgMember.deleteMany({ where: { userId: owner.sub } })
    expect(
      await outcome(
        invites.createInvite(
          orgId,
          { email: recipient.email! },
          admitted,
          createInvitationOperationId()
        )
      )
    ).toBe(403)
    expect(await prisma.orgInvite.count()).toBe(0)
  })
}
