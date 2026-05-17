import type { Organization, OrgMember, Role } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import {
  AppException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import type { PrismaService } from '../../prisma'
import type { AppAbility } from '../auth/casl/ability.factory'
import type { OrgAclVersionService } from '../auth/org-acl-version.service'

import { OrganizationsService } from './organizations.service'

// findOne reads `ability.can(Read, Organization)` only for api_key
// principals (OA-03). JWT cases pass `allowAbility()`; api_key cases
// pick the variant that matches the scenario under test.
const allowAbility = (): AppAbility =>
  ({ can: jest.fn().mockReturnValue(true) }) as unknown as AppAbility
const denyAbility = (): AppAbility =>
  ({ can: jest.fn().mockReturnValue(false) }) as unknown as AppAbility

describe('OrganizationsService', () => {
  let service: OrganizationsService
  let prisma: DeepMockProxy<PrismaClient>
  let aclVersionService: jest.Mocked<Pick<OrgAclVersionService, 'invalidate'>>

  const mockOrg: Organization = {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    aclVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockRole: Role = {
    id: 'role-admin',
    name: 'ADMIN',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const mockMember: OrgMember = {
    id: 'member-1',
    userId: 'user-1',
    organizationId: 'org-1',
    createdAt: new Date(),
  }

  const mockPrincipal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-1',
    email: 'user@example.com',
    systemRole: SystemRole.User,
    organizationId: 'org-1',
    aclVersion: 0,
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    aclVersionService = { invalidate: jest.fn().mockResolvedValue(undefined) }
    service = new OrganizationsService(
      prisma as unknown as PrismaService,
      aclVersionService as unknown as OrgAclVersionService
    )
  })

  describe('create', () => {
    it('creates org with auto-generated slug and assigns ADMIN role to creator', async () => {
      prisma.organization.findUnique.mockResolvedValue(null) // slug not taken
      prisma.role.findFirst.mockResolvedValue(mockRole)
      // $transaction is mocked to return the org — the callback is an implementation detail
      prisma.$transaction.mockResolvedValue(mockOrg)

      const result = await service.create('user-1', { name: 'Acme Corp' })

      expect(result).toEqual(mockOrg)
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'ADMIN', isSystem: true, organizationId: null },
      })
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('throws ConflictException when provided slug is already taken', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg) // slug taken

      await expect(service.create('user-1', { name: 'Acme', slug: 'acme-corp' })).rejects.toThrow(
        ConflictException
      )
    })

    it('throws AppException when system roles are not seeded', async () => {
      prisma.organization.findUnique.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue(null) // no ADMIN role

      await expect(service.create('user-1', { name: 'Acme Corp' })).rejects.toThrow(AppException)
    })
  })

  describe('findAllForUser', () => {
    it('returns organizations mapped from user memberships', async () => {
      prisma.orgMember.findMany.mockResolvedValue([
        { ...mockMember, organization: mockOrg } as OrgMember & { organization: Organization },
      ] as never)

      const result = await service.findAllForUser('user-1')

      expect(result).toEqual([mockOrg])
    })
  })

  describe('findOne', () => {
    it('returns org when JWT principal is a member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)

      // JWT path does not consult ability — denyAbility() proves the
      // check is skipped (would otherwise throw).
      const result = await service.findOne('org-1', mockPrincipal, denyAbility())
      expect(result).toEqual(mockOrg)
    })

    it('returns org when JWT principal has no org-context but is a member (read does not require /switch)', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)

      const noOrgPrincipal: RequestPrincipal = {
        ...mockPrincipal,
        organizationId: undefined,
        aclVersion: undefined,
      }

      // JWT without org-context has an empty personal ability;
      // denyAbility() simulates that exactly. The check is skipped
      // for JWT.
      const result = await service.findOne('org-1', noOrgPrincipal, denyAbility())
      expect(result).toEqual(mockOrg)
    })

    it('throws NotFoundException when org does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null)
      prisma.orgMember.findUnique.mockResolvedValue(null)

      await expect(service.findOne('org-1', mockPrincipal, allowAbility())).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws ForbiddenException when user is not a member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(null)

      await expect(service.findOne('org-1', mockPrincipal, allowAbility())).rejects.toThrow(
        ForbiddenException
      )
    })

    // OA-03: API-key principals are bound to one org per ADR-033 and
    // must not read another org's record, even when the owning user is
    // a member of both. The 403 here proves the credential-boundary
    // check fires before the membership/existence Prisma queries — note
    // the mocks are not asserted, because the early return prevents
    // them from being called.
    it('OA-03: throws ForbiddenException when api_key principal targets a different org', async () => {
      const apiKeyPrincipal: RequestPrincipal = {
        ...mockPrincipal,
        type: 'api_key',
        organizationId: 'org-bound', // bound to a different org than the request
        aclVersion: 0,
        scopes: ['read:Organization'],
      }

      await expect(service.findOne('org-1', apiKeyPrincipal, allowAbility())).rejects.toThrow(
        ForbiddenException
      )
      expect(prisma.organization.findUnique).not.toHaveBeenCalled()
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
    })

    // OA-03 (follow-up): api_key bound to the requested org but with a
    // scope that does NOT include read:Organization (e.g. `read:User`)
    // must still be denied — `userPerms ∩ scopes` per ADR-033. The
    // ability is built from `permsInBoundOrg ∩ scopes` so a key with
    // only `read:User` resolves can(Read, Organization) === false.
    it('OA-03: throws ForbiddenException when api_key bound to same org but ability denies read:Organization', async () => {
      const apiKeyPrincipal: RequestPrincipal = {
        ...mockPrincipal,
        type: 'api_key',
        organizationId: 'org-1',
        aclVersion: 0,
        scopes: ['read:User'], // does not allow read:Organization
      }

      const ability = denyAbility() // can(Read, Organization) === false
      await expect(service.findOne('org-1', apiKeyPrincipal, ability)).rejects.toThrow(
        ForbiddenException
      )
      expect(ability.can).toHaveBeenCalledWith('read', 'Organization')
      expect(prisma.organization.findUnique).not.toHaveBeenCalled()
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
    })

    it('OA-03: returns org when api_key principal targets its bound org with read:Organization in ability', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)

      const apiKeyPrincipal: RequestPrincipal = {
        ...mockPrincipal,
        type: 'api_key',
        organizationId: 'org-1',
        aclVersion: 0,
        scopes: ['read:Organization'],
      }

      const result = await service.findOne('org-1', apiKeyPrincipal, allowAbility())
      expect(result).toEqual(mockOrg)
    })
  })

  describe('update', () => {
    it('throws ForbiddenException when principal.organizationId does not match', async () => {
      const wrongPrincipal: RequestPrincipal = { ...mockPrincipal, organizationId: 'org-other' }

      await expect(service.update('org-1', wrongPrincipal, { name: 'New Name' })).rejects.toThrow(
        ForbiddenException
      )
    })

    it('updates org when caller is in the correct org context', async () => {
      prisma.organization.findFirst.mockResolvedValue(null) // no slug conflict
      prisma.organization.update.mockResolvedValue({ ...mockOrg, name: 'New Name' })

      const result = await service.update('org-1', mockPrincipal, { name: 'New Name' })
      expect(result.name).toBe('New Name')
    })
  })

  describe('remove', () => {
    it('throws ForbiddenException when principal.organizationId does not match', async () => {
      const wrongPrincipal: RequestPrincipal = { ...mockPrincipal, organizationId: undefined }
      await expect(service.remove('org-1', wrongPrincipal)).rejects.toThrow(ForbiddenException)
    })

    it('deletes org when caller is in the correct org context', async () => {
      prisma.organization.delete.mockResolvedValue(mockOrg)
      await expect(service.remove('org-1', mockPrincipal)).resolves.toBeUndefined()
    })
  })

  describe('getForSwitch', () => {
    it('throws ForbiddenException when user is not a member', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(null)
      await expect(service.getForSwitch('org-1', 'user-1')).rejects.toThrow(ForbiddenException)
    })

    it('returns aclVersion when user is a member', async () => {
      prisma.orgMember.findUnique.mockResolvedValue({
        ...mockMember,
        organization: { aclVersion: 5 },
      } as never)

      const result = await service.getForSwitch('org-1', 'user-1')
      expect(result).toEqual({ aclVersion: 5 })
    })
  })

  describe('bumpAclVersion', () => {
    it('increments aclVersion in the database', async () => {
      prisma.organization.update.mockResolvedValue({ ...mockOrg, aclVersion: 1 })
      await service.bumpAclVersion('org-1')
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { aclVersion: { increment: 1 } },
      })
      expect(aclVersionService.invalidate).toHaveBeenCalledWith('org-1')
    })

    it('increments aclVersion inside an existing transaction without invalidating Redis', async () => {
      await service.bumpAclVersionTx('org-1', prisma as never)

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { aclVersion: { increment: 1 } },
      })
      expect(aclVersionService.invalidate).not.toHaveBeenCalled()
    })

    it('invalidates aclVersion cache through the dedicated wrapper', async () => {
      await service.invalidateAclVersion('org-1')
      expect(aclVersionService.invalidate).toHaveBeenCalledWith('org-1')
    })
  })
})
