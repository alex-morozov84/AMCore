jest.mock('../../organizations/invite.service', () => ({ InviteService: class {} }))

import type { ExecutionContext } from '@nestjs/common'

import { SystemRole } from '@amcore/shared'

import { InvitesController } from '../../organizations/invites.controller'
import { MembersController } from '../../organizations/members.controller'
import { OrganizationsController } from '../../organizations/organizations.controller'
import { RolesController } from '../../organizations/roles.controller'
import { TEAM_ACCESS_KEY } from '../decorators/require-team-access.decorator'

import { TeamAccessGuard } from './team-access.guard'

const request = () => ({
  params: { orgId: 'org' },
  user: {
    sub: 'actor',
    type: 'jwt',
    organizationId: 'org',
    systemRole: SystemRole.User as SystemRole,
    aclVersion: 0,
  },
  teamAccess: {
    actorId: 'actor',
    type: 'jwt',
    organizationId: 'org',
    aclVersion: 1,
    ownerTrusted: true,
    credentialTrusted: true,
  },
})
const context = (value: unknown): ExecutionContext =>
  ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => value }),
  }) as unknown as ExecutionContext

describe('TeamAccessGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue('orgId') }
  const prisma = { orgMember: { findUnique: jest.fn().mockResolvedValue({ id: 'member' }) } }
  const guard = new TeamAccessGuard(reflector as never, prisma as never)
  beforeEach(() => {
    reflector.getAllAndOverride.mockReturnValue('orgId')
    prisma.orgMember.findUnique.mockReset().mockResolvedValue({ id: 'member' })
  })
  it('requires actual target/identity and both trust decisions without credential fallback', async () => {
    for (const overrides of [
      { actorId: 'foreign' },
      { type: 'api_key' },
      { organizationId: 'foreign' },
      { ownerTrusted: false },
      { credentialTrusted: false },
    ]) {
      const req = request()
      Object.assign(req.teamAccess, overrides)
      await expect(guard.canActivate(context(req))).rejects.toMatchObject({
        errorCode: 'FORBIDDEN',
      })
    }
    expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
  })
  it('rechecks normal JWT live membership and propagates infrastructure failures', async () => {
    await expect(guard.canActivate(context(request()))).resolves.toBe(true)
    prisma.orgMember.findUnique.mockResolvedValueOnce(null)
    await expect(guard.canActivate(context(request()))).rejects.toThrow()
    const failure = new Error('database unavailable')
    prisma.orgMember.findUnique.mockRejectedValueOnce(failure)
    await expect(guard.canActivate(context(request()))).rejects.toBe(failure)
  })
  it('keeps the existing SUPER_ADMIN management membership exception', async () => {
    const req = request()
    req.user.systemRole = SystemRole.SuperAdmin
    await expect(guard.canActivate(context(req))).resolves.toBe(true)
    expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
  })
  it('keys use the already-admitted membership and require bound ACL version', async () => {
    const req = request()
    req.user.type = 'api_key'
    req.teamAccess.type = 'api_key'
    req.teamAccess.aclVersion = 0
    await expect(guard.canActivate(context(req))).resolves.toBe(true)
    expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
    req.teamAccess.aclVersion = 1
    await expect(guard.canActivate(context(req))).rejects.toThrow()
  })
  it('only the thirteen selected handlers require full team authority', () => {
    const groups: [object, string[], string][] = [
      [
        RolesController.prototype,
        [
          'listRoles',
          'createRole',
          'updateRole',
          'deleteRole',
          'assignPermission',
          'removePermission',
        ],
        'orgId',
      ],
      [
        MembersController.prototype,
        ['invite', 'removeMember', 'assignRole', 'removeRole'],
        'orgId',
      ],
      [InvitesController.prototype, ['listInvites', 'revokeInvite'], 'orgId'],
      [OrganizationsController.prototype, ['remove'], 'id'],
    ]
    for (const [prototype, handlers, param] of groups) {
      for (const handler of handlers)
        expect(
          Reflect.getMetadata(TEAM_ACCESS_KEY, (prototype as Record<string, object>)[handler]!)
        ).toBe(param)
    }
    expect(
      Reflect.getMetadata(TEAM_ACCESS_KEY, OrganizationsController.prototype.update)
    ).toBeUndefined()
  })
})
