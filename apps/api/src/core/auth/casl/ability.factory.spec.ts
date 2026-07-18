import { subject } from '@casl/ability'
import { Test, TestingModule } from '@nestjs/testing'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { OrgAclVersionService } from '../org-acl-version.service'
import { PermissionsCacheService } from '../permissions-cache.service'

import { AbilityFactory } from './ability.factory'

describe('AbilityFactory', () => {
  let factory: AbilityFactory
  let permissionsCache: jest.Mocked<PermissionsCacheService>
  let orgAclVersion: jest.Mocked<Pick<OrgAclVersionService, 'getCurrent'>>

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
    const mockOrgAclVersion = {
      getCurrent: jest.fn().mockResolvedValue(5),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbilityFactory,
        {
          provide: PermissionsCacheService,
          useValue: mockPermissionsCache,
        },
        {
          provide: OrgAclVersionService,
          useValue: mockOrgAclVersion,
        },
      ],
    }).compile()

    factory = module.get<AbilityFactory>(AbilityFactory)
    permissionsCache = module.get(PermissionsCacheService)
    orgAclVersion = module.get(OrgAclVersionService)
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
      expect(orgAclVersion.getCurrent).not.toHaveBeenCalled()
    })

    // AK-02 (closed 2026-05-16, Stage 3): SUPER_ADMIN early return must not
    // bypass apiKey.scopes.
    //
    // Stage 4 / AK-09 unified the super-admin path with the normal flow:
    // SUPER_ADMIN principals synthesize a single owner permission
    // `manage:all` and pass through applyScopes. The intersection
    // algorithm naturally narrows it by scope. As a consequence, two
    // tests below differ from their Stage 3 form — wildcard scopes
    // (read:all, manage:Organization) now intersect correctly with the
    // synthetic owner permission and produce real rules instead of being
    // dropped wholesale. `manage:all` scope remains dropped (defense-in-
    // depth until AK-05 scope registry).
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
        expect(orgAclVersion.getCurrent).not.toHaveBeenCalled()
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
        expect(orgAclVersion.getCurrent).not.toHaveBeenCalled()
      })

      // manage:all is the only scope shape that has "no narrowing" effect
      // — it would make the api_key JWT-equivalent. Dropped in applyScopes
      // as defense-in-depth until AK-05's scope registry rejects it at
      // the schema layer.
      it('SUPER_ADMIN api-key with manage:all does NOT get full access (dropped until AK-05)', async () => {
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

      // Stage 4 / AK-09 changed this from "dropped wholesale" to
      // "intersected correctly". `read:all` intersected with the synthetic
      // owner permission `manage:all` produces `read:all`, so the key can
      // read any subject. `manage:Organization` intersected likewise
      // produces `manage:Organization`.
      it('SUPER_ADMIN api-key with read:all reads any subject (AK-09)', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['read:all'],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Read, Subject.Organization)).toBe(true)
        // Action narrows to read — no write
        expect(ability.can(Action.Create, Subject.Organization)).toBe(false)
        expect(ability.can(Action.Delete, Subject.User)).toBe(false)
      })

      it('SUPER_ADMIN api-key with manage:Organization manages Organization only (AK-09)', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['manage:Organization'],
        }

        const ability = await factory.createForUser(principal)

        expect(ability.can(Action.Read, Subject.Organization)).toBe(true)
        expect(ability.can(Action.Update, Subject.Organization)).toBe(true)
        expect(ability.can(Action.Delete, Subject.Organization)).toBe(true)
        // Subject narrows to Organization — no User
        expect(ability.can(Action.Read, Subject.User)).toBe(false)
        expect(ability.can(Action.Manage, Subject.User)).toBe(false)
      })

      // Follow-up to GPT review of Stage 3: the ADR-033 invariant was
      // originally nested in the no-org branch, but the SUPER_ADMIN
      // branch fired first and would have silently produced a scoped
      // ability for a malformed super-admin api_key principal. After
      // the hoist, the invariant catches this case too.
      it('rejects SUPER_ADMIN api_key principal without organization context (ADR-033)', async () => {
        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'admin-1',
          systemRole: SystemRole.SuperAdmin,
          scopes: ['read:User'],
        }

        await expect(factory.createForUser(principal)).rejects.toThrow(/ADR-033/)
        expect(permissionsCache.getPermissions).not.toHaveBeenCalled()
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

    // AK-09 (closed 2026-05-16, Stage 4): wildcard-aware scope intersection.
    //
    // Permissions are stored in the DB with CASL wildcards (`manage`,
    // `all`) — seed.ts grants MEMBER `read:all` / `create:all` and ADMIN
    // `manage:Organization` / etc. Stage 4 rewrote applyScopes() to
    // compute pairwise intersection that understands these wildcards on
    // both axes, producing narrowed rules instead of dropping permissions
    // wholesale.
    //
    // These tests cover the public createForUser() behavior for ordinary
    // (non-super-admin) users. The four canonical cases from the AK-09
    // review are listed first, followed by deny propagation, conditions
    // preservation, and disjoint actions.
    describe('AK-09: wildcard-aware scope intersection', () => {
      const principalOf = (scopes: string[]): RequestPrincipal => ({
        type: 'api_key',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
        scopes,
      })

      // Case: scope read:User × perm manage:Organization (disjoint subject)
      // implicitly covered below by the negative assertions, but the four
      // canonical cases come first.

      it('MEMBER read:all permission + scope read:User → can read User only', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'read',
            subject: 'all',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['read:User']))

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Read, Subject.Organization)).toBe(false)
        expect(ability.can(Action.Create, Subject.User)).toBe(false)
      })

      it('ADMIN manage:Organization permission + scope read:Organization → can only read Organization', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'manage',
            subject: 'Organization',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['read:Organization']))

        expect(ability.can(Action.Read, Subject.Organization)).toBe(true)
        expect(ability.can(Action.Update, Subject.Organization)).toBe(false)
        expect(ability.can(Action.Delete, Subject.Organization)).toBe(false)
      })

      it('perm read:all + scope manage:User → can read User (narrowed on both axes)', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'read',
            subject: 'all',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['manage:User']))

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Update, Subject.User)).toBe(false)
        expect(ability.can(Action.Read, Subject.Organization)).toBe(false)
      })

      it('perm manage:User + scope manage:User → full management of User', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'manage',
            subject: 'User',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['manage:User']))

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Update, Subject.User)).toBe(true)
        expect(ability.can(Action.Delete, Subject.User)).toBe(true)
        expect(ability.can(Action.Manage, Subject.Organization)).toBe(false)
      })

      it('disjoint actions yield empty ability', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'read',
            subject: 'all',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['delete:User']))

        expect(ability.can(Action.Delete, Subject.User)).toBe(false)
        expect(ability.can(Action.Read, Subject.User)).toBe(false)
      })

      it('inverted permission propagates through intersection (deny survives narrowing)', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'allow',
            action: 'manage',
            subject: 'User',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
          {
            id: 'deny',
            action: 'delete',
            subject: 'User',
            conditions: null,
            fields: [],
            inverted: true,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['manage:User']))

        expect(ability.can(Action.Read, Subject.User)).toBe(true)
        expect(ability.can(Action.Update, Subject.User)).toBe(true)
        // Deny narrowed to delete:User and overrides the broader manage allow.
        expect(ability.can(Action.Delete, Subject.User)).toBe(false)
      })

      it('conditions preserved through intersection (e.g. own-id constraint)', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'update',
            subject: 'User',
            conditions: { id: '${user.sub}' },
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const principal: RequestPrincipal = {
          type: 'api_key',
          sub: 'user-1',
          systemRole: SystemRole.User,
          organizationId: 'org-1',
          aclVersion: 5,
          scopes: ['manage:User'],
        }

        const ability = await factory.createForUser(principal)

        // Conditions interpolated → can only update own user.
        expect(ability.can(Action.Update, subject('User', { id: 'user-1' } as any))).toBe(true)
        expect(ability.can(Action.Update, subject('User', { id: 'other' } as any))).toBe(false)
      })

      it('non-super-admin api_key with scope manage:all → empty ability (dropped until AK-05)', async () => {
        permissionsCache.getPermissions.mockResolvedValueOnce([
          {
            id: 'p',
            action: 'read',
            subject: 'all',
            conditions: null,
            fields: [],
            inverted: false,
            organizationId: 'org-1',
          },
        ] as any)

        const ability = await factory.createForUser(principalOf(['manage:all']))

        expect(ability.can(Action.Read, Subject.User)).toBe(false)
        expect(ability.can(Action.Manage, Subject.All)).toBe(false)
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
      expect(orgAclVersion.getCurrent).not.toHaveBeenCalled()
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

    it('should load permissions from cache when current aclVersion is 0 (fresh org)', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 999,
      }
      orgAclVersion.getCurrent.mockResolvedValueOnce(0)
      permissionsCache.getPermissions.mockResolvedValue([])

      await factory.createForUser(principal)

      expect(orgAclVersion.getCurrent).toHaveBeenCalledWith('org-1')
      expect(permissionsCache.getPermissions).toHaveBeenCalledWith('user-1', 'org-1', 0)
    })

    it('OA-04: JWT org user uses current aclVersion, not stale JWT payload aclVersion', async () => {
      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-1',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 3,
      }

      orgAclVersion.getCurrent.mockResolvedValueOnce(4)
      permissionsCache.getPermissions.mockResolvedValueOnce(mockPermissions as any)

      const ability = await factory.createForUser(principal)

      expect(orgAclVersion.getCurrent).toHaveBeenCalledWith('org-1')
      expect(permissionsCache.getPermissions).toHaveBeenCalledWith('user-1', 'org-1', 4)
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

      // Permission has condition: { id: '${user.sub}' } → interpolated to { id: 'user-123' }.
      // Object-level checks (not just the class-level check below) prove the interpolated
      // condition actually discriminates: it must match the user's own record and reject
      // everyone else's, not just report "a rule exists for Read User".
      expect(ability.can(Action.Read, Subject.User)).toBe(true)
      expect(ability.can(Action.Read, subject('User', { id: 'user-123' } as any))).toBe(true)
      expect(ability.can(Action.Read, subject('User', { id: 'someone-else' } as any))).toBe(false)
      expect(orgAclVersion.getCurrent).toHaveBeenCalledWith('org-1')
    })

    it('treats empty-object conditions ({}) as unconditioned, same as null conditions', async () => {
      permissionsCache.getPermissions.mockResolvedValueOnce([
        {
          id: 'perm-empty-conditions',
          action: 'read',
          subject: 'User',
          conditions: {},
          fields: [],
          inverted: false,
          organizationId: 'org-1',
        },
      ] as any)

      const principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'user-123',
        systemRole: SystemRole.User,
        organizationId: 'org-1',
        aclVersion: 5,
      }

      const ability = await factory.createForUser(principal)

      // An empty conditions object must not accidentally deny everything — it must behave
      // exactly like no conditions at all (matches any User record).
      expect(ability.can(Action.Read, subject('User', { id: 'user-123' } as any))).toBe(true)
      expect(ability.can(Action.Read, subject('User', { id: 'someone-else' } as any))).toBe(true)
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
      expect(orgAclVersion.getCurrent).toHaveBeenCalledWith('org-1')
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
      expect(orgAclVersion.getCurrent).not.toHaveBeenCalled()
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

      expect(orgAclVersion.getCurrent).toHaveBeenCalledWith('org-1')
      expect(ability.can(Action.Read, Subject.User)).toBe(true)
      expect(ability.can(Action.Create, Subject.Organization)).toBe(true)
    })
  })
})
