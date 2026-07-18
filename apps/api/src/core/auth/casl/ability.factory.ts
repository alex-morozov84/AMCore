import { type PureAbility, type RawRuleOf } from '@casl/ability'
import { createPrismaAbility, type PrismaQuery, type Subjects } from '@casl/prisma'
import { Injectable } from '@nestjs/common'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { OrgAclVersionService } from '../org-acl-version.service'
import { PermissionsCacheService } from '../permissions-cache.service'

import { interpolateConditions } from './interpolate-conditions'

import type { Organization, Permission, Role, User } from '@/generated/prisma/client'

// Define Prisma subjects (add domain models as they're created: Contact, Deal, etc.)
type AppSubjects =
  | 'all'
  | Subjects<{
      User: User
      Organization: Organization
      Role: Role
      Permission: Permission
    }>

// AppAbility type for CASL + Prisma
export type AppAbility = PureAbility<[string, AppSubjects], PrismaQuery>

// Structural subset of Prisma's Permission the factory actually uses.
// Keeping the surface narrow lets us synthesize owner permissions (e.g.
// for SUPER_ADMIN) without inventing fake id/timestamp fields and
// documents that the rule-building pipeline only depends on these five.
type AbilityPermission = Pick<
  Permission,
  'action' | 'subject' | 'conditions' | 'fields' | 'inverted'
>

// Synthesized owner-permission baseline for SUPER_ADMIN principals.
// JWT super-admin (no scopes) gets manage:all unchanged; api_key
// super-admin runs this through applyScopes and the scopes narrow it.
const SUPER_ADMIN_OWNER_PERMISSIONS: AbilityPermission[] = [
  {
    action: Action.Manage,
    subject: Subject.All,
    conditions: null,
    fields: [],
    inverted: false,
  },
]

@Injectable()
export class AbilityFactory {
  constructor(
    private readonly permissionsCache: PermissionsCacheService,
    private readonly orgAclVersion: OrgAclVersionService
  ) {}

  /**
   * Build a CASL ability for the request principal.
   *
   * Flow:
   *  1. ADR-033 invariant — api_key principal must carry org context.
   *  2. SUPER_ADMIN: synthesize manage:all and pass through applyScopes
   *     (unified with the normal flow — see AK-09).
   *  3. JWT users without org context get minimal personal permissions.
   *     api_key principals are unreachable here per (1).
   *  4. Normal flow: load org permissions, intersect with scopes,
   *     build ability.
   */
  async createForUser(principal: RequestPrincipal): Promise<AppAbility> {
    // ADR-033 invariant — hoisted to the top so every downstream branch
    // sees a well-formed api_key principal. A guard that forgot to
    // attach org context must fail loudly rather than receive a
    // partially-authorized ability.
    if (
      principal.type === 'api_key' &&
      (!principal.organizationId || principal.aclVersion == null)
    ) {
      throw new Error('API key principal must carry organization context (ADR-033)')
    }

    if (principal.systemRole === SystemRole.SuperAdmin) {
      const effective = this.applyScopes(SUPER_ADMIN_OWNER_PERMISSIONS, principal.scopes)
      return this.buildAbility(effective, principal)
    }

    if (!principal.organizationId || principal.aclVersion == null) {
      return this.buildPersonalAbility(principal)
    }

    const organizationId = principal.organizationId
    const aclVersion =
      principal.type === 'jwt'
        ? // ADR-035 / OA-04: JWT payload aclVersion can be stale.
          // Current org aclVersion is authoritative for permission
          // cache key selection; api_key principals already get the
          // current version in ApiKeyGuard.
          await this.orgAclVersion.getCurrent(organizationId)
        : principal.aclVersion

    const permissions = await this.permissionsCache.getPermissions(
      principal.sub,
      organizationId,
      aclVersion
    )
    const effective = this.applyScopes(permissions, principal.scopes)
    return this.buildAbility(effective, { ...principal, aclVersion })
  }

  /**
   * Intersect owner permissions with API-key scopes (AK-09).
   *
   * For JWT users (scopes === undefined) returns owner permissions
   * unchanged. For api_key principals computes the pairwise intersection
   * of every (scope, permission) pair via {@link intersect}; the
   * intersection can only narrow, never expand.
   *
   * `manage:all` scope is dropped here as defense-in-depth. The primary
   * line of validation is `createApiKeySchema` (AK-05), which rejects
   * `manage:all` at the DTO layer with `API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN`.
   * This drop survives only for seed scripts / raw DB writes / future
   * bypass scenarios that skip Zod validation. Drop is applied to the
   * scope side only — the synthesized SUPER_ADMIN owner permission
   * `{manage, all}` is the granted side and must pass through untouched
   * (otherwise super-admin api_keys would always be empty).
   *
   * Strict `parts.length !== 2` parsing rejects malformed scopes such
   * as `read:User:extra` instead of silently truncating them.
   *
   * Conditions / fields / inverted are preserved from the permission
   * side — scopes are coarse action×subject filters, while those three
   * operate on the resource axis and belong to the user's grant.
   */
  private applyScopes(permissions: AbilityPermission[], scopes?: string[]): AbilityPermission[] {
    if (!scopes) return permissions

    const result: AbilityPermission[] = []
    for (const scope of scopes) {
      const parts = scope.split(':')
      if (parts.length !== 2) continue
      const [scopeAction, scopeSubject] = parts
      if (!scopeAction || !scopeSubject) continue
      if (scopeAction === Action.Manage && scopeSubject === Subject.All) continue

      for (const perm of permissions) {
        const narrowed = this.intersect(scopeAction, scopeSubject, perm.action, perm.subject)
        if (!narrowed) continue
        result.push({ ...perm, action: narrowed.action, subject: narrowed.subject })
      }
    }
    return result
  }

  /**
   * Wildcard-aware intersection of a scope with a permission.
   * Returns the narrowed (action, subject) pair, or null when disjoint.
   *
   * Lattice:
   *  - Action.Manage is the top of the action axis.
   *  - Subject.All is the top of the subject axis.
   *  - intersect(top, X) = X on each axis independently.
   *
   * Pure math — policy decisions live in {@link applyScopes}.
   */
  private intersect(
    scopeAction: string,
    scopeSubject: string,
    permAction: string,
    permSubject: string
  ): { action: string; subject: string } | null {
    let action: string
    if (scopeAction === permAction) action = permAction
    else if (scopeAction === Action.Manage) action = permAction
    else if (permAction === Action.Manage) action = scopeAction
    else return null

    let subject: string
    if (scopeSubject === permSubject) subject = permSubject
    else if (scopeSubject === Subject.All) subject = permSubject
    else if (permSubject === Subject.All) subject = scopeSubject
    else return null

    return { action, subject }
  }

  /** Build CASL ability from effective permissions, interpolating conditions. */
  private buildAbility(permissions: AbilityPermission[], principal: RequestPrincipal): AppAbility {
    const rules: RawRuleOf<AppAbility>[] = []
    for (const permission of permissions) {
      const conditions = permission.conditions
        ? interpolateConditions(permission.conditions as Record<string, unknown>, principal)
        : undefined

      const rawRule: RawRuleOf<AppAbility> = {
        action: permission.action,
        subject: permission.subject,
        conditions,
        inverted: permission.inverted,
        ...(permission.fields.length > 0 && { fields: permission.fields }),
      } as RawRuleOf<AppAbility>

      rules.push(rawRule)
    }
    return createPrismaAbility(rules)
  }

  /** Minimal personal ability for JWT users without org context. */
  private buildPersonalAbility(principal: RequestPrincipal): AppAbility {
    return createPrismaAbility([
      {
        action: Action.Read,
        subject: Subject.User,
        conditions: { id: principal.sub },
      },
      {
        action: Action.Update,
        subject: Subject.User,
        conditions: { id: principal.sub },
      },
    ])
  }
}
