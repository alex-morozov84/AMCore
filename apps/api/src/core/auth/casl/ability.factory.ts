import { type Ability, type RawRuleOf } from '@casl/ability'
import { Injectable } from '@nestjs/common'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { OrgAclVersionService } from '../org-acl-version.service'
import { PermissionsCacheService } from '../permissions-cache.service'
import type { PrivilegedAdmission } from '../privileged-admission.service'

import { OWN_USER_READ_FIELDS, OWN_USER_UPDATE_FIELDS } from './org-role-defaults'
import {
  type AbilityPermission,
  hasFullTeamAccess,
  narrowPermissions,
  normalizeOwnerPermissions,
} from './permission-normalization'
import { createPrismaAbility, type PrismaQuery, type Subjects } from './prisma-ability'

import type { Organization, Permission, Role, User } from '@/generated/prisma/client'

type AppSubjects =
  | 'all'
  | 'TeamAccess'
  | Subjects<{
      User: User
      Organization: Organization
      Role: Role
      Permission: Permission
    }>
export type AppAbility = Ability<[string, AppSubjects], PrismaQuery>

export interface TeamAccessDecision {
  actorId: string
  type: RequestPrincipal['type']
  organizationId?: string
  aclVersion?: number
  ownerTrusted: boolean
  credentialTrusted: boolean
}

@Injectable()
export class AbilityFactory {
  constructor(
    private readonly permissionsCache: PermissionsCacheService,
    private readonly orgAclVersion: OrgAclVersionService
  ) {}

  async createForUser(admission: PrivilegedAdmission): Promise<AppAbility> {
    return (await this.createAuthorizationContext(admission)).ability
  }

  async createAuthorizationContext(admission: PrivilegedAdmission): Promise<{
    ability: AppAbility
    teamAccess: TeamAccessDecision
  }> {
    const { principal, authenticated, currentRole } = admission
    if (
      principal.type === 'api_key' &&
      (!principal.organizationId || principal.aclVersion == null)
    ) {
      throw new Error('API key principal must carry organization context (ADR-033)')
    }
    const superAdmin =
      principal.systemRole === SystemRole.SuperAdmin &&
      authenticated.systemRole === SystemRole.SuperAdmin &&
      currentRole === SystemRole.SuperAdmin
    const aclVersion =
      !superAdmin &&
      principal.organizationId &&
      principal.type === 'jwt' &&
      principal.aclVersion != null
        ? await this.orgAclVersion.getCurrent(principal.organizationId)
        : principal.aclVersion
    const boundPrincipal = { ...principal, aclVersion }
    const raw = await this.ownerPermissions(boundPrincipal, superAdmin)
    const owner = normalizeOwnerPermissions(raw, boundPrincipal, superAdmin)
    const ownerTrusted = superAdmin || hasFullTeamAccess(owner)
    const effective = narrowPermissions(
      owner,
      principal.type === 'api_key' ? (principal.scopes ?? []) : principal.scopes
    )
    const rules = effective.map(({ action, subject, conditions, fields, inverted }) => ({
      action,
      subject,
      inverted,
      ...(conditions !== null && { conditions }),
      ...(fields.length > 0 && { fields }),
    })) as RawRuleOf<AppAbility>[]
    return {
      ability: createPrismaAbility<AppAbility>(rules),
      teamAccess: {
        actorId: principal.sub,
        type: principal.type,
        organizationId: principal.organizationId,
        aclVersion,
        ownerTrusted,
        credentialTrusted:
          ownerTrusted &&
          (principal.type !== 'api_key' ||
            principal.scopes?.includes(`${Action.Manage}:${Subject.TeamAccess}`) === true),
      },
    }
  }

  private async ownerPermissions(
    principal: RequestPrincipal,
    superAdmin: boolean
  ): Promise<AbilityPermission[]> {
    if (superAdmin)
      return [
        {
          id: 'synthetic-super-admin',
          action: Action.Manage,
          subject: Subject.All,
          conditions: null,
          fields: [],
          inverted: false,
        },
      ]
    if (principal.organizationId && principal.aclVersion != null) {
      return this.permissionsCache.getPermissions(
        principal.sub,
        principal.organizationId,
        principal.aclVersion
      )
    }
    return [
      {
        id: 'synthetic-self-read',
        action: Action.Read,
        subject: Subject.User,
        conditions: { id: principal.sub },
        fields: OWN_USER_READ_FIELDS,
        inverted: false,
      },
      {
        id: 'synthetic-self-update',
        action: Action.Update,
        subject: Subject.User,
        conditions: { id: principal.sub },
        fields: OWN_USER_UPDATE_FIELDS,
        inverted: false,
      },
    ]
  }
}
