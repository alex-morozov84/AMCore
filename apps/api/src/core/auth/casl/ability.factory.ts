import { type PureAbility, type RawRuleOf } from '@casl/ability'
import { createPrismaAbility, type PrismaQuery, type Subjects } from '@casl/prisma'
import { Injectable } from '@nestjs/common'
import type { Organization, Permission, Role, User } from '@prisma/client'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { PermissionsCacheService } from '../permissions-cache.service'

import { interpolateConditions } from './interpolate-conditions'

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

/**
 * AbilityFactory
 *
 * Builds CASL abilities from user permissions.
 *
 * Flow:
 * 1. Check if SUPER_ADMIN → grant all permissions
 * 2. If no org context → minimal personal permissions (read/update own profile)
 * 3. Load permissions from cache (PermissionsCacheService)
 * 4. Build CASL ability with interpolated conditions
 *
 * The resulting ability is used in:
 * - Guards (PoliciesGuard) to check authorization
 * - Services (via accessibleBy()) to filter queries
 */
@Injectable()
export class AbilityFactory {
  constructor(private readonly permissionsCache: PermissionsCacheService) {}

  /**
   * Create CASL ability for a user
   *
   * @param principal - RequestPrincipal from JWT or API key
   * @returns AppAbility with rules from user's permissions
   */
  async createForUser(principal: RequestPrincipal): Promise<AppAbility> {
    const rules: RawRuleOf<AppAbility>[] = []

    // SUPER_ADMIN has full access to everything
    if (principal.systemRole === SystemRole.SuperAdmin) {
      rules.push({ action: Action.Manage, subject: Subject.All })
      return createPrismaAbility(rules)
    }

    // If no organization context, grant minimal personal permissions
    if (!principal.organizationId || principal.aclVersion == null) {
      // User can read and update their own profile
      rules.push({
        action: Action.Read,
        subject: Subject.User,
        conditions: { id: principal.sub },
      })
      rules.push({
        action: Action.Update,
        subject: Subject.User,
        conditions: { id: principal.sub },
      })
      return createPrismaAbility(rules)
    }

    // Load permissions from cache
    const permissions = await this.permissionsCache.getPermissions(
      principal.sub,
      principal.organizationId,
      principal.aclVersion
    )

    // Apply scope filtering for API keys
    const effectivePermissions = this.applyScopes(permissions, principal.scopes)

    // Build ability from permissions
    for (const permission of effectivePermissions) {
      // Interpolate conditions: replace ${user.sub} with actual values
      const conditions = permission.conditions
        ? interpolateConditions(permission.conditions as Record<string, unknown>, principal)
        : undefined

      // Build raw rule from database permission
      // Type assertion needed: DB stores strings, CASL expects typed subjects
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

  /**
   * Apply scope filtering for API keys
   *
   * Effective permissions = userPermissions ∩ scopes
   * - If scopes is undefined (JWT user) → return all permissions
   * - If scopes is defined (API key) → filter permissions to only those in scopes
   *
   * Scope format: "action:subject" (e.g., "read:Contact", "create:Deal")
   *
   * @param permissions - User's permissions from roles
   * @param scopes - API key scopes (undefined for JWT users)
   * @returns Filtered permissions
   */
  private applyScopes(permissions: Permission[], scopes?: string[]): Permission[] {
    // No scopes = JWT user = full permissions
    if (!scopes) {
      return permissions
    }

    // Parse scopes into action:subject pairs
    const allowedScopes = new Set(scopes)

    // Filter permissions to only those in scopes
    return permissions.filter((permission) => {
      const scopeKey = `${permission.action}:${permission.subject}`
      return allowedScopes.has(scopeKey)
    })
  }
}
