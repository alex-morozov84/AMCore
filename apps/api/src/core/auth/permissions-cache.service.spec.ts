import { Test, TestingModule } from '@nestjs/testing'
import type { Permission } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { type AppRedisClient, REDIS_CLIENT, RedisLockService } from '../../infrastructure/redis'

import { PermissionsCacheService } from './permissions-cache.service'

import { PrismaService } from '@/prisma'

describe('PermissionsCacheService', () => {
  let service: PermissionsCacheService
  let redis: jest.Mocked<Pick<AppRedisClient, 'get' | 'set' | 'del'>>
  let lock: jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
  let prisma: PrismaService
  let mockLogger: jest.Mocked<PinoLogger>

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
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsCacheService,
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: RedisLockService,
          useValue: {
            acquire: jest.fn(),
            release: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            orgMember: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    }).compile()

    service = module.get<PermissionsCacheService>(PermissionsCacheService)
    redis = module.get(REDIS_CLIENT)
    lock = module.get(RedisLockService)
    prisma = module.get<PrismaService>(PrismaService)

    jest
      .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    service.resetMetrics()
  })

  describe('getPermissions', () => {
    it('should return cached permissions on cache hit', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify(mockPermissions))

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(redis.get).toHaveBeenCalledWith('auth:perm:v2:org-1:user-1:5')
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
    })

    it('should treat cached empty permissions array as hit', async () => {
      redis.get.mockResolvedValueOnce('[]')

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual([])
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
    })

    it('should query database and cache on cache miss', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as never)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(lock.acquire).toHaveBeenCalledWith('auth:lock:perm:v2:org-1:user-1', 5000)
      expect(lock.release).toHaveBeenCalledWith('auth:lock:perm:v2:org-1:user-1', 'lock-token')
      expect(redis.set).toHaveBeenCalledWith(
        'auth:perm:v2:org-1:user-1:5',
        JSON.stringify(mockPermissions),
        {
          expiration: { type: 'PX', value: 3600000 },
        }
      )
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

    it('should return and cache empty array if user is not a member', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(null)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual([])
      expect(redis.set).toHaveBeenCalledWith('auth:perm:v2:org-1:user-1:5', '[]', {
        expiration: { type: 'PX', value: 3600000 },
      })
    })

    it('should delete corrupt cache and refill from database', async () => {
      redis.get.mockResolvedValueOnce('{bad-json').mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as never)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(redis.del).toHaveBeenCalledWith('auth:perm:v2:org-1:user-1:5')
      expect(prisma.orgMember.findUnique).toHaveBeenCalledTimes(1)
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
                  permissionId: 'perm-1',
                  permission: mockPermissions[0],
                },
              ],
            },
          },
        ],
      }

      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest
        .spyOn(prisma.orgMember, 'findUnique')
        .mockResolvedValueOnce(memberWithDuplicates as never)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toHaveLength(2)
      expect(result).toEqual(mockPermissions)
    })

    it('should use different cache keys for different aclVersions', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockPermissions))

      await service.getPermissions('user-1', 'org-1', 5)
      await service.getPermissions('user-1', 'org-1', 6)

      expect(redis.get).toHaveBeenCalledWith('auth:perm:v2:org-1:user-1:5')
      expect(redis.get).toHaveBeenCalledWith('auth:perm:v2:org-1:user-1:6')
    })

    it('should wait and retry if lock is held by another request', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(mockPermissions))
      lock.acquire.mockResolvedValueOnce(null)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()
    })

    it('should fall back to database after lock contention timeout', async () => {
      redis.get.mockResolvedValue(null)
      lock.acquire.mockResolvedValue(null)
      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as never)

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual(mockPermissions)
      expect(lock.acquire).toHaveBeenCalledTimes(5)
      expect(prisma.orgMember.findUnique).toHaveBeenCalledTimes(1)
    })
  })

  describe('getMetrics', () => {
    it('should track hits and misses', async () => {
      redis.get
        .mockResolvedValueOnce(JSON.stringify(mockPermissions))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as never)

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
      redis.get.mockResolvedValueOnce(JSON.stringify(mockPermissions))
      await service.getPermissions('user-1', 'org-1', 5)

      service.resetMetrics()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
    })
  })
})
