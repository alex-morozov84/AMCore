import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'
import type { EnvService } from '../../env/env.service'
import type { EmailService } from '../../infrastructure/email'
import type { PrismaService } from '../../prisma'
import type { AuditLogService } from '../audit'
import { EmailIdentityService } from '../auth/email-identity.service'
import type { UserCacheService } from '../auth/user-cache.service'

import { invitationActor } from './invitation-actor'
import type { InvitationAuthorization } from './invitation-authorization'
import { InviteService } from './invite.service'
import type { InviteAcceptService } from './invite-accept.service'
import type { InviteRateLimiterService } from './invite-rate-limiter.service'
import type { InviteRevokeService } from './invite-revoke.service'

import type { OrgInvite, OrgMember, PrismaClient, Role, User } from '@/generated/prisma/client'

// InviteService imports EmailService, which transitively pulls the ESM-only
// React Email / FormatJS chain. Mock the leaves so this unit suite loads
// (same pattern as email.service.spec.ts / email.processor.spec.ts).
jest.mock('@react-email/render', () => ({
  render: jest.fn(async () => '<html></html>'),
}))
jest.mock('@formatjs/intl', () => ({
  createIntl: jest.fn(() => ({ formatMessage: jest.fn((descriptor) => descriptor.id) })),
}))

describe('InviteService', () => {
  let service: InviteService
  let prisma: DeepMockProxy<PrismaClient>
  let userCacheService: jest.Mocked<Pick<UserCacheService, 'getUser'>>
  let inviteRateLimiter: jest.Mocked<Pick<InviteRateLimiterService, 'check' | 'consume'>>
  let emailService: jest.Mocked<Pick<EmailService, 'sendOrgInviteEmail'>>
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>
  let env: { get: jest.Mock }
  let logger: jest.Mocked<PinoLogger>

  const memberRole: Role = {
    id: 'role-member',
    name: 'MEMBER',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const customRole: Role = {
    id: 'role-custom-1',
    name: 'Editor',
    description: null,
    isSystem: false,
    organizationId: 'org-1',
  }

  const targetUser: User = {
    id: 'user-target',
    email: 'invited@example.com',
    emailCanonical: 'invited@example.com',
    emailVerified: true,
    passwordHash: null,
    name: null,
    avatarUrl: null,
    avatarGeneration: 0,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  }

  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-admin',
    email: 'admin@example.com',
    systemRole: SystemRole.User,
    organizationId: 'org-1',
    aclVersion: 0,
  }

  const actor = invitationActor({
    user: principal,
    privilegedAdmission: { authenticated: principal, principal },
  })
  const inviteRow: OrgInvite = {
    id: 'invite-1',
    organizationId: 'org-1',
    emailCanonical: 'invited@example.com',
    email: 'invited@example.com',
    roleId: 'role-member',
    invitedById: 'user-admin',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    prisma.$queryRaw.mockImplementation((async (query: unknown) => {
      const sql = (query as TemplateStringsArray).join('')
      if (sql.includes('FROM core.roles'))
        return [await prisma.role.findUnique({ where: { id: 'unused' } })] as never
      if (sql.includes('FROM core.org_invites')) return [inviteRow] as never
      if (sql.includes('AS value')) return [{ value: new Date() }] as never
      return [{ id: 'org-1', aclVersion: 0 }] as never
    }) as never)
    userCacheService = { getUser: jest.fn() }
    inviteRateLimiter = {
      check: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
    }
    emailService = { sendOrgInviteEmail: jest.fn().mockResolvedValue(undefined) }
    auditLog = { record: jest.fn().mockResolvedValue(undefined) }
    env = { get: jest.fn().mockReturnValue('https://app.example.com') }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new InviteService(
      prisma as unknown as PrismaService,
      new EmailIdentityService(),
      userCacheService as unknown as UserCacheService,
      inviteRateLimiter as unknown as InviteRateLimiterService,
      emailService as unknown as EmailService,
      env as unknown as EnvService,
      auditLog as unknown as AuditLogService,
      logger,
      {
        lockActor: jest.fn().mockResolvedValue({ id: principal.sub }),
        authorize: jest.fn().mockResolvedValue(undefined),
        checkKeyClock: jest.fn(),
      } as unknown as InvitationAuthorization,
      {} as InviteAcceptService,
      {} as InviteRevokeService
    )
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
    prisma.orgInvite.updateMany.mockResolvedValue({ count: 1 })
  })

  describe('createInvite', () => {
    it('rejects with ForbiddenException when org context does not match', async () => {
      await expect(
        service.createInvite('org-other', { email: 'x@example.com' }, actor)
      ).rejects.toThrow(ForbiddenException)
      expect(inviteRateLimiter.check).not.toHaveBeenCalled()
    })

    it('returns uniform {status: invited} on Branch B (known user, not member)', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      const result = await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.create).toHaveBeenCalledTimes(1)
      expect(inviteRateLimiter.consume).toHaveBeenCalledWith(
        'org-1',
        'invited@example.com',
        principal.sub
      )
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall).toBeDefined()
      expect(auditCall?.[0]).toEqual(
        expect.objectContaining({ branch: 'pending_known_user', actorCredentialType: 'jwt' })
      )
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.invite_created',
          organizationId: 'org-1',
          targetId: 'invite-1',
        }),
        expect.objectContaining({ tx: prisma })
      )
    })

    it('returns uniform {status: invited} on Branch C (unknown email)', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      const result = await service.createInvite('org-1', { email: 'newperson@example.com' }, actor)

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.create).toHaveBeenCalledTimes(1)
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall?.[0]).toEqual(expect.objectContaining({ branch: 'pending_new_email' }))
    })

    it('returns uniform {status: invited} on Branch A (already a member) — no row, no email', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      const existingMember: OrgMember = {
        id: 'member-existing',
        userId: targetUser.id,
        organizationId: 'org-1',
        createdAt: new Date(),
      }
      prisma.orgMember.findUnique.mockResolvedValue(existingMember)

      const result = await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.create).not.toHaveBeenCalled()
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall?.[0]).toEqual(
        expect.objectContaining({ branch: 'noop_already_member', inviteId: null, roleId: null })
      )
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'org.invite_created' }),
        expect.objectContaining({ tx: prisma })
      )
    })

    it('rotates an existing active row instead of inserting a duplicate', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })
      prisma.orgInvite.update.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })

      const result = await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.update).toHaveBeenCalledTimes(1)
      expect(prisma.orgInvite.create).not.toHaveBeenCalled()
      const updateArg = prisma.orgInvite.update.mock.calls[0]?.[0] as {
        where: { id: string }
        data: { tokenHash: string; expiresAt: Date; roleId: string; invitedById: string }
      }
      expect(updateArg.where).toEqual({ id: 'invite-existing' })
      expect(updateArg.data.tokenHash).toBeDefined()
      expect(updateArg.data.invitedById).toBe(principal.sub)
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall?.[0]).toEqual(expect.objectContaining({ branch: 'rotated_existing' }))
    })

    it('rejects foreign-org roleId with ForbiddenException (OA-05 via RoleAssignabilityService)', async () => {
      prisma.role.findUnique.mockResolvedValue({ ...customRole, organizationId: 'org-other' })

      await expect(
        service.createInvite(
          'org-1',
          { email: 'invited@example.com', roleId: 'role-custom-1' },
          actor
        )
      ).rejects.toThrow(ForbiddenException)
      expect(prisma.orgInvite.create).not.toHaveBeenCalled()
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
    })

    it('defaults to system MEMBER role when dto.roleId omitted', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'someone@example.com' }, actor)

      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { name: 'MEMBER', organizationId: null },
        select: { id: true, isSystem: true },
      })
      const createArg = prisma.orgInvite.create.mock.calls[0]?.[0] as {
        data: { roleId: string }
      }
      expect(createArg.data.roleId).toBe(memberRole.id)
    })

    it('serializes create-or-rotate by advisory lock on org and canonical email', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'Invited@Example.COM' }, actor)

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    })

    it('hashes email canonical with sha256 in audit log payload — never raw', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'leak-check@example.com' }, actor)

      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      const payload = auditCall?.[0] as { emailHash: string }
      expect(payload.emailHash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(payload)).not.toContain('leak-check@example.com')
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.not.objectContaining({
            email: expect.anything(),
            token: expect.anything(),
          }),
        }),
        expect.anything()
      )
    })

    it('fails closed when transactional audit insert fails', async () => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)
      auditLog.record.mockRejectedValueOnce(new Error('audit down'))

      await expect(
        service.createInvite('org-1', { email: 'audit@example.com' }, actor)
      ).rejects.toThrow('Invitation write unconfirmed')
      expect(emailService.sendOrgInviteEmail).not.toHaveBeenCalled()
    })
  })

  describe('createInvite — email dispatch (Stage D)', () => {
    const inviterUser: User = {
      ...targetUser,
      id: 'user-admin',
      email: 'admin@example.com',
      name: 'Org Admin',
    }

    beforeEach(() => {
      prisma.role.findMany.mockResolvedValue([memberRole])
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Acme Inc.',
      } as never)
      userCacheService.getUser.mockResolvedValue(inviterUser)
    })

    it('sends an org invite email with hasAccount=true for a known non-member', async () => {
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(emailService.sendOrgInviteEmail).toHaveBeenCalledTimes(1)
      const [to, data] = emailService.sendOrgInviteEmail.mock.calls[0]!
      expect(to).toBe('invited@example.com')
      expect(data).toEqual(
        expect.objectContaining({
          orgName: 'Acme Inc.',
          inviterName: 'Org Admin',
          inviterEmail: 'admin@example.com',
          roleName: 'MEMBER',
          hasAccount: true,
          locale: 'ru',
        })
      )
      // Raw token reaches the recipient only via acceptUrl.
      expect(data.acceptUrl).toMatch(/^https:\/\/app\.example\.com\/ru\/invite\/accept\?token=.+/)
    })

    it('sends an org invite email with hasAccount=false for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'newperson@example.com' }, actor)

      expect(emailService.sendOrgInviteEmail).toHaveBeenCalledTimes(1)
      const [, data] = emailService.sendOrgInviteEmail.mock.calls[0]!
      expect(data.hasAccount).toBe(false)
      // No account yet, so no stored preference — falls back to the base locale.
      expect(data.locale).toBe('en')
    })

    it('sends an org invite email when rotating an existing active row', async () => {
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })
      prisma.orgInvite.update.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })

      await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(emailService.sendOrgInviteEmail).toHaveBeenCalledTimes(1)
    })

    it('does NOT send an email when the target is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue({
        id: 'member-existing',
        userId: targetUser.id,
        organizationId: 'org-1',
        createdAt: new Date(),
      })

      await service.createInvite('org-1', { email: 'invited@example.com' }, actor)

      expect(emailService.sendOrgInviteEmail).not.toHaveBeenCalled()
    })

    it('swallows a dispatch failure and still returns uniform 202 (row already committed)', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)
      emailService.sendOrgInviteEmail.mockRejectedValue(new Error('queue down'))

      const result = await service.createInvite('org-1', { email: 'newperson@example.com' }, actor)

      expect(result).toEqual({ status: 'invited' })
      const warnCall = logger.warn.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.email_dispatch_failed'
      )
      expect(warnCall).toBeDefined()
      // The failure log must not carry the raw token.
      expect(JSON.stringify(warnCall?.[0])).not.toContain('token=')
    })
  })

  describe('listInvites', () => {
    it('rejects with ForbiddenException when org context does not match', async () => {
      await expect(service.listInvites('org-other', principal, 1, 20)).rejects.toThrow(
        ForbiddenException
      )
    })

    it('returns paginated active invites with createdAt DESC, id ASC sort', async () => {
      prisma.orgInvite.findMany.mockResolvedValue([inviteRow])
      ;(prisma.orgInvite.count as unknown as jest.Mock).mockResolvedValue(1)

      const result = await service.listInvites('org-1', principal, 2, 10)

      expect(result.total).toBe(1)
      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(result.data).toHaveLength(1)
      const findManyArg = prisma.orgInvite.findMany.mock.calls[0]?.[0] as {
        skip: number
        take: number
        orderBy: Array<Record<string, string>>
        where: Record<string, unknown>
      }
      expect(findManyArg.skip).toBe(10) // (page-1) * limit
      expect(findManyArg.take).toBe(10)
      expect(findManyArg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }])
      expect(findManyArg.where).toEqual(
        expect.objectContaining({
          organizationId: 'org-1',
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        })
      )
    })

    it('does not expose tokenHash in response shape', async () => {
      prisma.orgInvite.findMany.mockResolvedValue([inviteRow])
      ;(prisma.orgInvite.count as unknown as jest.Mock).mockResolvedValue(1)

      const result = await service.listInvites('org-1', principal, 1, 20)
      expect(result.data[0]).not.toHaveProperty('tokenHash')
      expect(result.data[0]).toEqual({
        id: inviteRow.id,
        email: inviteRow.email,
        roleId: inviteRow.roleId,
        invitedById: inviteRow.invitedById,
        expiresAt: expect.any(String),
        createdAt: expect.any(String),
      })
    })
  })
})
