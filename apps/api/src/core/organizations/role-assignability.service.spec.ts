import type { PrismaClient, Role } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { ForbiddenException } from '../../common/exceptions'

import { RoleAssignabilityService } from './role-assignability.service'

describe('RoleAssignabilityService', () => {
  let service: RoleAssignabilityService
  let prisma: DeepMockProxy<PrismaClient>

  const systemRole: Role = {
    id: 'role-system',
    name: 'MEMBER',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const sameOrgCustomRole: Role = {
    id: 'role-custom-a',
    name: 'Editor',
    description: null,
    isSystem: false,
    organizationId: 'org-a',
  }

  const foreignCustomRole: Role = {
    id: 'role-custom-b',
    name: 'Editor',
    description: null,
    isSystem: false,
    organizationId: 'org-b',
  }

  const orphanCustomRole: Role = {
    // `isSystem === false` with `organizationId === null` — a raw-SQL
    // insert or bad seed could create this. The assertion correctly
    // rejects it because neither branch matches (not a system role per
    // `isSystem`, and not an owned custom role per `organizationId`).
    id: 'role-orphan',
    name: 'OrphanCustom',
    description: null,
    isSystem: false,
    organizationId: null,
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new RoleAssignabilityService()
  })

  it('passes when role is a system role (isSystem=true, organizationId=null)', async () => {
    prisma.role.findUnique.mockResolvedValue(systemRole)
    await expect(service.assert('role-system', 'org-a', prisma)).resolves.toBeUndefined()
  })

  it('passes when role is a custom role owned by the same org', async () => {
    prisma.role.findUnique.mockResolvedValue(sameOrgCustomRole)
    await expect(service.assert('role-custom-a', 'org-a', prisma)).resolves.toBeUndefined()
  })

  it('rejects custom role from a different org with uniform ForbiddenException', async () => {
    prisma.role.findUnique.mockResolvedValue(foreignCustomRole)
    await expect(service.assert('role-custom-b', 'org-a', prisma)).rejects.toThrow(
      ForbiddenException
    )
    await expect(service.assert('role-custom-b', 'org-a', prisma)).rejects.toThrow(
      'Role is not assignable in this organization'
    )
  })

  it('rejects non-existent roleId with the same uniform 403 — no enumeration', async () => {
    prisma.role.findUnique.mockResolvedValue(null)
    await expect(service.assert('role-missing', 'org-a', prisma)).rejects.toThrow(
      ForbiddenException
    )
    await expect(service.assert('role-missing', 'org-a', prisma)).rejects.toThrow(
      'Role is not assignable in this organization'
    )
  })

  it('rejects orphan custom row (isSystem=false with null organizationId)', async () => {
    // The defence-in-depth filter for malformed `isSystem=true,
    // organizationId !== null` rows lives in `PermissionsCacheService`
    // (Stage 4 OA-05 DiD tightening), not at this layer — by contract,
    // `assert()` here treats any row whose `organizationId === orgId` as
    // assignable regardless of `isSystem`. The orphan case is the only
    // shape this layer rejects beyond the four documented branches.
    prisma.role.findUnique.mockResolvedValue(orphanCustomRole)
    await expect(service.assert('role-orphan', 'org-a', prisma)).rejects.toThrow(ForbiddenException)
  })

  it('queries by roleId only, returning the columns the assertion consults', async () => {
    prisma.role.findUnique.mockResolvedValue(systemRole)
    await service.assert('role-system', 'org-a', prisma)
    expect(prisma.role.findUnique).toHaveBeenCalledWith({
      where: { id: 'role-system' },
      select: { organizationId: true, isSystem: true },
    })
  })
})
