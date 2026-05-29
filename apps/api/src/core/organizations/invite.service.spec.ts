import type { OrgInvite, OrgMember, PrismaClient, Role, User } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { InviteErrorCode, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { AppException, ForbiddenException, NotFoundException } from '../../common/exceptions'
import { BusinessRuleViolationException } from '../../common/exceptions/domain/business-rule.exception'
import type { EnvService } from '../../env/env.service'
import type { EmailService } from '../../infrastructure/email'
import type { PrismaService } from '../../prisma'
import { EmailIdentityService } from '../auth/email-identity.service'
import type { UserCacheService } from '../auth/user-cache.service'

import { InviteService } from './invite.service'
import type { InviteAcceptLimiterService } from './invite-accept-limiter.service'
import type { InviteRateLimiterService } from './invite-rate-limiter.service'
import type { OrganizationsService } from './organizations.service'
import { RoleAssignabilityService } from './role-assignability.service'

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
  let orgsService: jest.Mocked<
    Pick<OrganizationsService, 'bumpAclVersionTx' | 'invalidateAclVersion'>
  >
  let userCacheService: jest.Mocked<Pick<UserCacheService, 'getUser'>>
  let inviteRateLimiter: jest.Mocked<Pick<InviteRateLimiterService, 'check' | 'consume'>>
  let acceptLimiter: jest.Mocked<Pick<InviteAcceptLimiterService, 'check' | 'consume' | 'reset'>>
  let emailService: jest.Mocked<Pick<EmailService, 'sendOrgInviteEmail'>>
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
    orgsService = {
      bumpAclVersionTx: jest.fn().mockResolvedValue(undefined),
      invalidateAclVersion: jest.fn().mockResolvedValue(undefined),
    }
    userCacheService = { getUser: jest.fn() }
    inviteRateLimiter = {
      check: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
    }
    acceptLimiter = {
      check: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    }
    emailService = { sendOrgInviteEmail: jest.fn().mockResolvedValue(undefined) }
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
      orgsService as unknown as OrganizationsService,
      new EmailIdentityService(),
      new RoleAssignabilityService(),
      userCacheService as unknown as UserCacheService,
      inviteRateLimiter as unknown as InviteRateLimiterService,
      acceptLimiter as unknown as InviteAcceptLimiterService,
      emailService as unknown as EmailService,
      env as unknown as EnvService,
      logger
    )
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
    prisma.orgInvite.updateMany.mockResolvedValue({ count: 1 })
  })

  describe('createInvite', () => {
    it('rejects with ForbiddenException when org context does not match', async () => {
      await expect(
        service.createInvite('org-other', { email: 'x@example.com' }, principal)
      ).rejects.toThrow(ForbiddenException)
      expect(inviteRateLimiter.check).not.toHaveBeenCalled()
    })

    it('returns uniform {status: invited} on Branch B (known user, not member)', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      const result = await service.createInvite(
        'org-1',
        { email: 'invited@example.com' },
        principal
      )

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
    })

    it('returns uniform {status: invited} on Branch C (unknown email)', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      const result = await service.createInvite(
        'org-1',
        { email: 'newperson@example.com' },
        principal
      )

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.create).toHaveBeenCalledTimes(1)
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall?.[0]).toEqual(expect.objectContaining({ branch: 'pending_new_email' }))
    })

    it('returns uniform {status: invited} on Branch A (already a member) — no row, no email', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      const existingMember: OrgMember = {
        id: 'member-existing',
        userId: targetUser.id,
        organizationId: 'org-1',
        createdAt: new Date(),
      }
      prisma.orgMember.findUnique.mockResolvedValue(existingMember)

      const result = await service.createInvite(
        'org-1',
        { email: 'invited@example.com' },
        principal
      )

      expect(result).toEqual({ status: 'invited' })
      expect(prisma.orgInvite.create).not.toHaveBeenCalled()
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      expect(auditCall?.[0]).toEqual(
        expect.objectContaining({ branch: 'noop_already_member', inviteId: null, roleId: null })
      )
    })

    it('rotates an existing active row instead of inserting a duplicate', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })
      prisma.orgInvite.update.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })

      const result = await service.createInvite(
        'org-1',
        { email: 'invited@example.com' },
        principal
      )

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
          principal
        )
      ).rejects.toThrow(ForbiddenException)
      expect(prisma.orgInvite.create).not.toHaveBeenCalled()
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
    })

    it('defaults to system MEMBER role when dto.roleId omitted', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'someone@example.com' }, principal)

      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
        select: { id: true },
      })
      const createArg = prisma.orgInvite.create.mock.calls[0]?.[0] as {
        data: { roleId: string }
      }
      expect(createArg.data.roleId).toBe(memberRole.id)
    })

    it('serializes create-or-rotate by advisory lock on org and canonical email', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'Invited@Example.COM' }, principal)

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    })

    it('hashes email canonical with sha256 in audit log payload — never raw', async () => {
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'leak-check@example.com' }, principal)

      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.created'
      )
      const payload = auditCall?.[0] as { emailHash: string }
      expect(payload.emailHash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(payload)).not.toContain('leak-check@example.com')
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
      prisma.role.findFirst.mockResolvedValue(memberRole)
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

      await service.createInvite('org-1', { email: 'invited@example.com' }, principal)

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
      expect(data.acceptUrl).toMatch(/^https:\/\/app\.example\.com\/invite\/accept\?token=.+/)
    })

    it('sends an org invite email with hasAccount=false for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)

      await service.createInvite('org-1', { email: 'newperson@example.com' }, principal)

      expect(emailService.sendOrgInviteEmail).toHaveBeenCalledTimes(1)
      const [, data] = emailService.sendOrgInviteEmail.mock.calls[0]!
      expect(data.hasAccount).toBe(false)
      expect(data.locale).toBe('ru')
    })

    it('sends an org invite email when rotating an existing active row', async () => {
      prisma.user.findUnique.mockResolvedValue(targetUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })
      prisma.orgInvite.update.mockResolvedValue({ ...inviteRow, id: 'invite-existing' })

      await service.createInvite('org-1', { email: 'invited@example.com' }, principal)

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

      await service.createInvite('org-1', { email: 'invited@example.com' }, principal)

      expect(emailService.sendOrgInviteEmail).not.toHaveBeenCalled()
    })

    it('swallows a dispatch failure and still returns uniform 202 (row already committed)', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.orgInvite.findFirst.mockResolvedValue(null)
      prisma.orgInvite.create.mockResolvedValue(inviteRow)
      emailService.sendOrgInviteEmail.mockRejectedValue(new Error('queue down'))

      const result = await service.createInvite(
        'org-1',
        { email: 'newperson@example.com' },
        principal
      )

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

  describe('revokeInvite', () => {
    it('rejects with ForbiddenException when org context does not match', async () => {
      await expect(service.revokeInvite('org-other', 'invite-1', principal)).rejects.toThrow(
        ForbiddenException
      )
    })

    it('throws 404 NotFoundException when invite is missing', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(null)
      await expect(service.revokeInvite('org-1', 'invite-missing', principal)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws 404 when invite belongs to a different org (no enumeration via org leak)', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        organizationId: 'org-other',
      })
      await expect(service.revokeInvite('org-1', inviteRow.id, principal)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws BusinessRuleViolation (409) when invite is already accepted', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        acceptedAt: new Date(),
      })
      await expect(service.revokeInvite('org-1', inviteRow.id, principal)).rejects.toThrow(
        BusinessRuleViolationException
      )
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
    })

    it('idempotent no-op on already-revoked invite — no write, no audit', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        revokedAt: new Date(),
      })
      await expect(service.revokeInvite('org-1', inviteRow.id, principal)).resolves.toBeUndefined()
      expect(prisma.orgInvite.update).not.toHaveBeenCalled()
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.revoked'
      )
      expect(auditCall).toBeUndefined()
    })

    it('sets revokedAt + revokedById and emits audit on happy path', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)

      await service.revokeInvite('org-1', inviteRow.id, principal)

      const updateArg = prisma.orgInvite.updateMany.mock.calls[0]?.[0] as {
        where: { id: string; organizationId: string; acceptedAt: null; revokedAt: null }
        data: { revokedAt: Date; revokedById: string }
      }
      expect(updateArg.where).toEqual({
        id: inviteRow.id,
        organizationId: 'org-1',
        acceptedAt: null,
        revokedAt: null,
      })
      expect(updateArg.data.revokedById).toBe(principal.sub)
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.revoked'
      )
      expect(auditCall?.[0]).toEqual(
        expect.objectContaining({ actorUserId: principal.sub, inviteId: inviteRow.id })
      )
    })

    it('throws BusinessRuleViolation when concurrent accept wins before revoke update', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      prisma.orgInvite.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.revokeInvite('org-1', inviteRow.id, principal)).rejects.toThrow(
        BusinessRuleViolationException
      )
    })
  })

  describe('acceptInvite', () => {
    const acceptIp = '203.0.113.5'
    const acceptToken = 'a'.repeat(43) // base64url 32-byte token shape

    const acceptUser: User = {
      ...targetUser,
      id: 'user-target',
      email: 'invited@example.com',
      emailVerified: true,
    }

    const acceptPrincipal: RequestPrincipal = {
      ...principal,
      sub: 'user-target',
      email: 'invited@example.com',
      organizationId: undefined,
    }

    it('throws 429 when limiter is saturated — DB never touched', async () => {
      acceptLimiter.check.mockRejectedValue(
        new AppException('too many', 429, 'RATE_LIMIT_EXCEEDED')
      )

      await expect(service.acceptInvite(acceptToken, acceptPrincipal, acceptIp)).rejects.toThrow(
        AppException
      )
      expect(prisma.orgInvite.findUnique).not.toHaveBeenCalled()
    })

    it('throws INVITE_INVALID_OR_EXPIRED + consume on token not found', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(null)

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
    })

    it('throws INVITE_INVALID_OR_EXPIRED on expired invite', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        expiresAt: new Date(Date.now() - 1000),
      })
      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
    })

    it('throws INVITE_INVALID_OR_EXPIRED on revoked invite', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        revokedAt: new Date(),
      })
      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
    })

    it('throws INVITE_INVALID_OR_EXPIRED on already-accepted invite', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        acceptedAt: new Date(),
      })
      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
    })

    it('throws INVITE_INVALID_OR_EXPIRED on email canonical mismatch', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({
        ...inviteRow,
        emailCanonical: 'someone-else@example.com',
      })
      userCacheService.getUser.mockResolvedValue(acceptUser)

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
    })

    it('throws INVITE_EMAIL_NOT_VERIFIED with 403 + consume when user unverified', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue({ ...acceptUser, emailVerified: false })

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_EMAIL_NOT_VERIFIED)
      expect(error.getStatus()).toBe(403)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
    })

    it('creates membership + role link, marks invite accepted, bumps aclVersion (happy path)', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue(acceptUser)
      prisma.role.findUnique.mockResolvedValue(memberRole) // re-check inside tx
      prisma.orgMember.create.mockResolvedValue({
        id: 'member-new',
        userId: acceptUser.id,
        organizationId: 'org-1',
        createdAt: new Date(),
      })

      const result = await service.acceptInvite(acceptToken, acceptPrincipal, acceptIp)

      expect(result).toEqual({ organizationId: 'org-1', roleId: 'role-member' })
      expect(prisma.orgInvite.updateMany).toHaveBeenCalledWith({
        where: {
          id: inviteRow.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { acceptedAt: expect.any(Date), acceptedByUserId: acceptUser.id },
      })
      expect(prisma.orgMember.create).toHaveBeenCalled()
      expect(prisma.memberRole.create).toHaveBeenCalledWith({
        data: { memberId: 'member-new', roleId: 'role-member' },
      })
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalledWith('org-1', prisma)
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
      expect(acceptLimiter.reset).toHaveBeenCalledTimes(1)
      const auditCall = logger.info.mock.calls.find(
        ([payload]) => (payload as { event?: string }).event === 'org.invite.accepted'
      )
      expect(auditCall?.[0]).toEqual(
        expect.objectContaining({
          orgId: 'org-1',
          inviteId: inviteRow.id,
          roleId: 'role-member',
          actorUserId: acceptUser.id,
        })
      )
    })

    it('falls back to system MEMBER role when invite.roleId is null', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue({ ...inviteRow, roleId: null })
      userCacheService.getUser.mockResolvedValue(acceptUser)
      prisma.role.findFirst.mockResolvedValue(memberRole)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.orgMember.create.mockResolvedValue({
        id: 'member-new',
        userId: acceptUser.id,
        organizationId: 'org-1',
        createdAt: new Date(),
      })

      const result = await service.acceptInvite(acceptToken, acceptPrincipal, acceptIp)
      expect(result.roleId).toBe(memberRole.id)
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
        select: { id: true },
      })
    })

    it('throws INVITE_ALREADY_MEMBER (409) on P2002 unique violation + consume', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue(acceptUser)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      prisma.orgMember.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.5.0',
          meta: { target: ['userId', 'organizationId'] },
        })
      )

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_ALREADY_MEMBER)
      expect(error.getStatus()).toBe(409)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
      expect(acceptLimiter.reset).not.toHaveBeenCalled()
    })

    it('throws INVITE_INVALID_OR_EXPIRED when concurrent revoke wins before accept claim', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue(acceptUser)
      prisma.orgInvite.updateMany.mockResolvedValue({ count: 0 })

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
      expect(prisma.orgMember.create).not.toHaveBeenCalled()
      expect(acceptLimiter.reset).not.toHaveBeenCalled()
    })

    it('does not consume limiter on infra errors (decision-vs-infra discriminator)', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue(acceptUser)
      prisma.role.findUnique.mockResolvedValue(memberRole)
      // Simulate Prisma pool timeout — not a decision-class failure.
      prisma.orgMember.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection', {
          code: 'P2024',
          clientVersion: '7.5.0',
        })
      )

      await expect(service.acceptInvite(acceptToken, acceptPrincipal, acceptIp)).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError
      )
      expect(acceptLimiter.consume).not.toHaveBeenCalled()
      expect(acceptLimiter.reset).not.toHaveBeenCalled()
    })

    it('rejects when user not found in cache (defense-in-depth) — consume + uniform 400', async () => {
      prisma.orgInvite.findUnique.mockResolvedValue(inviteRow)
      userCacheService.getUser.mockResolvedValue(null)

      const error = await service
        .acceptInvite(acceptToken, acceptPrincipal, acceptIp)
        .catch((e) => e)
      expect(error.errorCode).toBe(InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
      expect(acceptLimiter.consume).toHaveBeenCalledTimes(1)
    })
  })
})
