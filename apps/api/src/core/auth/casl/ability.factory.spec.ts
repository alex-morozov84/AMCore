import { Test, TestingModule } from '@nestjs/testing'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { PermissionsCacheService } from '../permissions-cache.service'

import { AbilityFactory } from './ability.factory'

describe('AbilityFactory', () => {
  let factory: AbilityFactory
  let permissionsCache: jest.Mocked<PermissionsCacheService>

  const mockPermissions = [
    {
      id: 'perm-1',
      action: 'read',
      subject: 'User',
      conditions: { id: '${user.sub}' },
      fields: [],
      inverted: false,
      organizationId: 'org-1',
    },
    {
      id: 'perm-2',
      action: 'create',
      subject: 'Organization',
      conditions: null,
      fields: [],
      inverted: false,
      organizationId: 'org-1',
    },
  ]

  beforeEach(async () => {
    const mockPermissionsCache = {
      getPermissions: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbilityFactory,
        {
          provide: PermissionsCacheService,
          useValue: mockPermissionsCache,
        },
      ],
    }).compile()

    factory = module.get<AbilityFactory>(AbilityFactory)
    permissionsCache = module.get(PermissionsCacheService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('createForUser', () => {
    it('should grant full access to SUPER_ADMIN', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'admin-1',
        systemRole: SystemRole.SuperAdmin,
      }

      const ability = await factory.createForUser(principal)

      expect(ability.can(Action.Manage, Subject.All)).toBe(true)
      expect(ability.can(Action.Delete, Subject.User)).toBe(true)
      expect(ability.can(Action.Create, Subject.Organization)).toBe(true)
      expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
    })

    // AK-02 (closed 2026-05-16, Stage 3): SUPER_ADMIN early return must not
    // bypass apiKey.scopes. For super-admin api_key principals, effective
    // permissions are the scope set itself (super-admin's userPerms = all,
    // so `all ∩ scopes = scopes`). Wildcard tokens are dropped at this
    // stage — see AK-09 for wildcard semantics, AK-05 for scope registry.
    describe('AK-02: SUPER_ADMIN api-key scope enforcement', () => {
      it('SUPER_ADMIN api-key with read:User can only read:User', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['read:User'],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
        expect(ability.can(Action.Delete, Subject.User)).toBe(false)
        expect(ability.can(Action.Manage, Subject.All)).toBe(false)
        expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
      })

      it('SUPER_ADMIN api-key with empty scopes has no permissions', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: [],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Read, Subject.User)).toBe(false)
        expect(ability.can(Action.Manage, Subject.All)).toBe(false)
        expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
        expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
      })

      it('SUPER_ADMIN api-key with manage:all does NOT get full access (AK-09 deferred)', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['manage:all'],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Manage, Subject.All)).toBe(false)
        expect(ability.can(Action.Delete, Subject.User)).toBe(false)
        expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
      })

      it('SUPER_ADMIN api-key drops wildcard scopes (read:all, manage:Organization)', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['read:all', 'manage:Organization', 'read:User'],
        }

        const ability = await factory.createForUser(principal)

        // read:User is concrete → allowed
        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        // read:all dropped → no broader read
        expect(ability.can(Action.Read, Subject.Organization)).toBe(false)
        // manage:Organization dropped → no manage on Organization
        expect(ability.can(Action.Delete, Subject.Organization)).toBe(false)
        expect(ability.can(Action.Update, Subject.Organization)).toBe(false)
      })

      it('SUPER_ADMIN api-key rejects malformed scopes', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          // `read:User:extra` must NOT silently become `read:User`;
          // `:User` and `read:` and `` are also malformed.
          scopes: ['read:User:extra', ':User', 'read:', ''],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Read, Subject.User)).toBe(false)
      })
    })

    it('should grant minimal permissions for user without org context', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
      }

      const ability = await factory.createForUser(principal)

      expect(ability.can(Action.Read, Subject.User)).toBe(true)
      expect(ability.can(Action.Update, Subject.User)).toBe(true)
      expect(ability.can(Action.Delete, Subject.User)).toBe(false)
      expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
    })

    // AK-04 / ADR-033: API-key principals must always carry org context.
    // Reaching the no-org branch with type='api_key' is a guard bug and
    // must fail loudly — silently granting personal permissions would
    // bypass apiKey.scopes entirely.
    it('rejects api_key principal without organization context (ADR-033)', async () => {
      const principal: RequestPrincipal = {
        type: 'api_key',
        sub: 'user-1',
        systemRole: SystemRole.User,
        scopes: ['read:User'],
      }

      await expect(factory.createForUser(principal)).rejects.toThrow(/ADR-033/)
      expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
    })

    it('should load permissions from cache when aclVersion is 0 (fresh org)', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 0,
      }
      permissionsCache.getPermissions.mockResolvedValue([])

      await factory.createForUser(principal)

      expect(permissionsCache.getPermissions).toHaveBeenCalledWith('user-1', 'org-1', 0)
    })

    it('should load permissions from cache for org user', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
      }

      permissionsCache.getPermissions.mockResolvedValueOnce(mockPermissions as any)

      const ability = await factory.createForUser(principal)

      expect(permissionsCache.getPermissions).toHaveBeenCalledWith('user-1', 'org-1', 5)
      expect(ability.can(Action.Read, Subject.User)).toBe(true)
      expect(ability.can(Action.Create, Subject.Organization)).toBe(true)
    })

    it('should interpolate conditions with user values', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-123',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
      }

      permissionsCache.getPermissions.mockResolvedValueOnce(mockPermissions as any)

      const ability = await factory.createForUser(principal)

      // Permission has condition: { id: '${user.sub}' } → interpolated to { id: 'user-123' }
      expect(ability.can(Action.Read, Subject.User)).toBe(true)
    })

    it('should handle inverted permissions (explicit deny)', async () => {
      const deniedPermission = [
        {
          id: 'perm-deny',
          action: 'delete',
          subject: 'User',
          conditions: null,
          fields: [],
          inverted: true,
          organizationId: 'org-1',
        },
      ]

      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
      }

      permissionsCache.getPermissions.mockResolvedValueOnce(deniedPermission as any)

      const ability = await factory.createForUser(principal)

      expect(ability.can(Action.Delete, Subject.User)).toBe(false)
    })

    it('should apply scopes for API key users', async () => {
      const principal: RequestPrincipal = {
        type: 'api_key',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
        scopes: ['read:User'],
      }

      permissionsCache.getPermissions.mockResolvedValueOnce(mockPermissions as any)

      const ability = await factory.createForUser(principal)

      // Should have read:User (in scopes + in permissions)
      expect(ability.can(Action.Read, Subject.User)).toBe(true)

      // Should NOT have create:Organization (not in scopes)
      expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
    })

    it('should grant full permissions for JWT users (no scopes)', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
      }

      permissionsCache.getPermissions.mockResolvedValueOnce(mockPermissions as any)

      const ability = await factory.createForUser(principal)

      expect(ability.can(Action.Read, Subject.User)).toBe(true)
      expect(ability.can(Action.Create, Subject.Organization)).toBe(true)
    })
  })
})
