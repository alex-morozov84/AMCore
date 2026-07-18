import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { type AppRedisClient, REDIS_CLIENT, RedisLockService } from '../../infrastructure/redis'

import { PermissionsCacheService } from './permissions-cache.service'

import type { Permission } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

describe('PermissionsCacheService', () => {
  let service: PermissionsCacheService
  let redis: jest.Mocked<Pick<AppRedisClient, 'get' | 'set' | 'del'>>
  let lock: jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
  let prisma: PrismaService
  let mockLogger: jest.Mocked<PinoLogger>
  let prometheus: jest.Mocked<Pick<MetricsService, 'incCacheOperation'>>

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
    prometheus = { incCacheOperation: jest.fn() }

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
        {
          provide: MetricsService,
          useValue: prometheus,
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
      expect(prometheus.incCacheOperation).toHaveBeenCalledWith('permissions', 'hit')
    })

    it('should treat cached empty permissions array as hit', async () => {
      redis.get.mockResolvedValueOnce('[]')

      const result = await service.getPermissions('user-1', 'org-1', 5)

      expect(result).toEqual([])
      expect(prisma.orgMember.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
      expect(prometheus.incCacheOperation).toHaveBeenCalledWith('permissions', 'hit')
      expect(prometheus.incCacheOperation).not.toHaveBeenCalledWith('permissions', 'negative_hit')
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
      expect(prometheus.incCacheOperation).toHaveBeenCalledWith('permissions', 'miss')
      expect(prometheus.incCacheOperation).toHaveBeenCalledWith('permissions', 'db_fallback')
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
      expect(prometheus.incCacheOperation).toHaveBeenCalledWith('permissions', 'corrupt')
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

    // OA-05 defense-in-depth: even if MemberService.assertRoleAssignable
    // is bypassed (raw SQL / migration / pre-fix data), the cache
    // loader must not surface permissions from a role whose
    // organizationId belongs to a different org. The primary fix is
    // in MemberService; this filter is a second wall.
    describe('OA-05: defense-in-depth filter for foreign-org role rows', () => {
      const foreignOrgPermission: Permission = {
        id: 'perm-foreign',
        action: 'manage',
        subject: 'Organization',
        conditions: null,
        fields: [],
        inverted: false,
        organizationId: 'org-b',
      }

      const memberWithForeignRole = {
        ...mockMember,
        roles: [
          mockMember.roles[0], // legit same-org role
          {
            id: 'member-role-foreign',
            memberId: 'member-1',
            roleId: 'role-from-org-b',
            role: {
              id: 'role-from-org-b',
              name: 'Editor',
              description: null,
              isSystem: false,
              organizationId: 'org-b',
              permissions: [
                {
                  roleId: 'role-from-org-b',
                  permissionId: 'perm-foreign',
                  permission: foreignOrgPermission,
                },
              ],
            },
          },
        ],
      }

      it('drops permissions from foreign-org roles and logs a warn', async () => {
        redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        lock.acquire.mockResolvedValueOnce('lock-token')
        jest
          .spyOn(prisma.orgMember, 'findUnique')
          .mockResolvedValueOnce(memberWithForeignRole as never)

        const result = await service.getPermissions('user-1', 'org-1', 5)

        // Only the legit role's permissions surface.
        expect(result).toEqual(mockPermissions)
        expect(result.some((p) => p.id === 'perm-foreign')).toBe(false)

        // Warn carries identifying metadata for the offending row but
        // no PII. The role/orgId arrays are observability signal: a
        // foreign-org row reaching the cache loader is either pre-fix
        // data or a bypass of the service layer.
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-1',
            organizationId: 'org-1',
            roleIds: ['role-from-org-b'],
            roleOrganizationIds: ['org-b'],
            roleIsSystem: [false],
          }),
          expect.stringContaining('OA-05')
        )
      })

      // Tightening: the filter mirrors MemberService.assertRoleAssignable
      // so it doesn't silently pass shapes the primary path would
      // reject. A "system" claim with a non-null organizationId, or a
      // non-system row with organizationId === null, are both rejected
      // even though the prior, looser filter would pass the latter.
      it('drops malformed roles (organizationId === null but isSystem === false) — mirrors assertRoleAssignable', async () => {
        const malformedPermission: Permission = {
          id: 'perm-malformed',
          action: 'manage',
          subject: 'all',
          conditions: null,
          fields: [],
          inverted: false,
          organizationId: null,
        }
        const memberWithMalformedRole = {
          ...mockMember,
          roles: [
            mockMember.roles[0],
            {
              id: 'member-role-malformed',
              memberId: 'member-1',
              roleId: 'role-malformed',
              role: {
                id: 'role-malformed',
                name: 'Wannabe-System',
                description: null,
                isSystem: false, // malformed: claims org-scope (null) but not system
                organizationId: null,
                permissions: [
                  {
                    roleId: 'role-malformed',
                    permissionId: 'perm-malformed',
                    permission: malformedPermission,
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
          .mockResolvedValueOnce(memberWithMalformedRole as never)

        const result = await service.getPermissions('user-1', 'org-1', 5)

        expect(result).toEqual(mockPermissions)
        expect(result.some((p) => p.id === 'perm-malformed')).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            roleIds: ['role-malformed'],
            roleOrganizationIds: [null],
            roleIsSystem: [false],
          }),
          expect.stringContaining('OA-05')
        )
      })

      it('does not warn when every role belongs to the requested org or is a system role', async () => {
        redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        lock.acquire.mockResolvedValueOnce('lock-token')
        jest.spyOn(prisma.orgMember, 'findUnique').mockResolvedValueOnce(mockMember as never)

        await service.getPermissions('user-1', 'org-1', 5)

        // No OA-05 warn — the mock has only a same-org role.
        const warnCalls = mockLogger.warn.mock.calls
        const oa05Warn = warnCalls.find(
          (call) => typeof call[1] === 'string' && call[1].includes('OA-05')
        )
        expect(oa05Warn).toBeUndefined()
      })
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
