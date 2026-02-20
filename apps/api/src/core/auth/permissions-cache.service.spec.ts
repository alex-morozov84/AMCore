import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Test, TestingModule } from '@nestjs/testing'
import type { Permission } from '@prisma/client'
import type { Cache } from 'cache-manager'

import { PermissionsCacheService } from './permissions-cache.service'

import { PrismaService } from '@/prisma'

describe('PermissionsCacheService', () => {
  let service: PermissionsCacheService
  let cache: jest.Mocked<Cache>
  let prisma: PrismaService

  const mockPermissions: Permission[] = [
    {
      id: 'perm-1',
      action: 'read',
      subject: 'Contact',
      conditions: { assignedToId: '${user.id}' },
      fields: [],
      inverted: false,
      organizationId: 'org-1',
    },
    {
      id: 'perm-2',
      action: 'create',
      subject: 'Contact',
      conditions: null,
      fields: [],
      inverted: false,
      organizationId: 'org-1',
    },
  ]

  const mockMember = {
    id: 'member-1',
    userId: 'user-1',
    organizationId: 'org-1',
    createdAt: new Date(),
    roles: [
      {
        id: 'member-role-1',
        memberId: 'member-1',
        roleId: 'role-1',
        role: {
          id: 'role-1',
          name: 'MEMBER',
          description: 'Member role',
          isSystem: true,
          organizationId: 'org-1',
          permissions: [
            {
              roleId: 'role-1',
              permissionId: 'perm-1',
              permission: mockPermissions[0],
            },
            {
              roleId: 'role-1',
              permissionId: 'perm-2',
              permission: mockPermissions[1],
            },
          ],
        },
      },
    ],
  }

  beforeEach(async () => {
    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsCacheService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
        {
          provide: PrismaService,
          useValue: {
            orgMember: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    service = module.get<PermissionsCacheService>(PermissionsCacheService)
    cache = module.get(CACHE_MANAGER)
    prisma = module.get<PrismaService>(PrismaService)
  })

  afterEach(() => {
    jest.clearAllMocks()
    service.resetMetrics()
  })

  describe('getPermissions', () => {
    it('should return cached permissions on cache hit', async () => {
      cache.get.mockResolvedValueOnce(mockPermissions)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(cache.get).toHaveBeenCalledWith('perm:org-1:user-1:5')
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
    })

    it('should query database and cache on cache miss', async () => {
      cache.get
        .mockResolvedValueOnce(null) // First check: cache miss
        .mockResolvedValueOnce(null) // Lock check: not locked
        .mockResolvedValueOnce(null) // Double-check after lock: still miss

      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as any)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(cache.set).toHaveBeenCalledWith('perm:org-1:user-1:5', mockPermissions, 3600000)
      expect(prisma.orgMember.findUnique).toHaveBeenCalledWith({
        where: {
          userId_organizationId: {
            userId: 'user-1',
            organizationId: 'org-1',
          },
        },
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(1)
      expect(metrics.dbQueries).toBe(1)
    })

    it('should return empty array if user is not a member', async () => {
      cache.get
        .mockResolvedValueOnce(null) // Cache miss
        .mockResolvedValueOnce(null) // Lock check
        .mockResolvedValueOnce(null) // Double-check

      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(null)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual([])
      expect(cache.set).toHaveBeenCalledWith('perm:org-1:user-1:5', [], 3600000)
    })

    it('should deduplicate permissions from multiple roles', async () => {
      const memberWithDuplicates = {
        ...mockMember,
        roles: [
          mockMember.roles[0],
          {
            id: 'member-role-2',
            memberId: 'member-1',
            roleId: 'role-2',
            role: {
              id: 'role-2',
              name: 'ADMIN',
              description: 'Admin role',
              isSystem: true,
              organizationId: 'org-1',
              permissions: [
                {
                  roleId: 'role-2',
                  permissionId: 'perm-1', // Same permission as in role-1
                  permission: mockPermissions[0],
                },
              ],
            },
          },
        ],
      }

      cache.get
        .mockResolvedValueOnce(null) // Cache miss
        .mockResolvedValueOnce(null) // Lock check
        .mockResolvedValueOnce(null) // Double-check

      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(memberWithDuplicates as any)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      // Should have 2 permissions (perm-1, perm-2), not 3
      expect(result).toHaveLength(2)
      expect(result).toEqual(mockPermissions)
    })

    it('should use different cache keys for different aclVersions', async () => {
      cache.get.mockResolvedValue(mockPermissions)

      await service.getPermissions('user-1', 'org-1', 5)
      await service.getPermissions('user-1', 'org-1', 6)

      expect(cache.get).toHaveBeenCalledWith('perm:org-1:user-1:5')
      expect(cache.get).toHaveBeenCalledWith('perm:org-1:user-1:6')
    })

    it('should wait and retry if lock is held by another request', async () => {
      cache.get
        .mockResolvedValueOnce(null) // First check: cache miss
        .mockResolvedValueOnce('1') // Lock check: locked
        .mockResolvedValueOnce(mockPermissions) // Retry: cache hit

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('getMetrics', () => {
    it('should track hits and misses', async () => {
      cache.get
        .mockResolvedValueOnce(mockPermissions) // Hit
        .mockResolvedValueOnce(null) // Miss
        .mockResolvedValueOnce(null) // Lock check
        .mockResolvedValueOnce(null) // Double-check

      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as any)

      await service.getPermissions('user-1', 'org-1', 5)
      await service.getPermissions('user-1', 'org-1', 6)

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)
      expect(metrics.total).toBe(2)
      expect(metrics.hitRate).toBe('50.00%')
    })

    it('should handle zero requests', () => {
      const metrics = service.getMetrics()
      expect(metrics.hitRate).toBe('0.00%')
    })
  })

  describe('resetMetrics', () => {
    it('should reset all metrics to zero', async () => {
      cache.get.mockResolvedValueOnce(mockPermissions)
      await service.getPermissions('user-1', 'org-1', 5)

      service.resetMetrics()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
    })
  })
})
