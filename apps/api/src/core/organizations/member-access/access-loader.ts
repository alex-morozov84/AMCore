import { HttpStatus } from '@nestjs/common'

import {
  ACCESS_MAX_LINKS,
  ACCESS_MAX_POLICY_BYTES,
  ACCESS_MAX_ROLES,
  ACCESS_MAX_UNIQUE_RULES,
  OrganizationMemberErrorCode,
  RoleDefinitionErrorCode,
} from '@amcore/shared'

import { AppException } from '../../../common/exceptions'

import type { StoredPolicyRule } from './access-facts'

import type { Organization } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'

export interface LoadedAccess {
  organization: Organization
  member: {
    memberId: string
    userId: string
    name: string | null
    email: string
    systemRole: string
  }
  roles: { id: string; name: string; isSystem: boolean }[]
  ruleIdsByRole: Map<string, string[]>
  rules: Map<string, StoredPolicyRule>
  unsafeLinkCount: number
}

const unavailable = (): AppException =>
  new AppException(
    'Member access cannot be explained',
    HttpStatus.SERVICE_UNAVAILABLE,
    RoleDefinitionErrorCode.ROLE_ACCESS_UNAVAILABLE
  )

interface Preflight {
  roles: number
  links: number
  rules: number
  bytes: number
}

/** One aggregate over the member's links; no rule JSON is loaded before it passes the limits. */
async function preflight(tx: Prisma.TransactionClient, memberId: string): Promise<Preflight> {
  const [row] = await tx.$queryRaw<Preflight[]>(Prisma.sql`
    WITH links AS (
      SELECT rp."permissionId" AS pid
        FROM core.role_permissions rp
        JOIN core.member_roles mr ON mr."roleId" = rp."roleId" AND mr."memberId" = ${memberId}
    ), uniq AS (SELECT DISTINCT pid FROM links)
    SELECT (SELECT count(*)::int FROM core.member_roles WHERE "memberId" = ${memberId}) AS roles,
           (SELECT count(*)::int FROM links) AS links,
           (SELECT count(*)::int FROM uniq) AS rules,
           LEAST(COALESCE((
             SELECT SUM(COALESCE(octet_length(p.conditions::text), 0)
                      + COALESCE(octet_length(array_to_string(p.fields, ',')), 0))
               FROM core.permissions p JOIN uniq u ON u.pid = p.id), 0), 2147483647)::int AS bytes`)
  return row ?? { roles: 0, links: 0, rules: 0, bytes: 0 }
}

const safe = (role: { isSystem: boolean; organizationId: string | null }, orgId: string): boolean =>
  (role.isSystem && role.organizationId === null) || role.organizationId === orgId

/**
 * Loads the organization, the member and the member's whole policy in the caller's snapshot.
 * Roles outside this organization (and not system templates) are excluded exactly like the
 * authorization loader excludes them and are only counted. Over any limit the request fails
 * whole: a partial policy would explain a decision the server does not make.
 */
export async function loadAccess(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string
): Promise<LoadedAccess> {
  const organization = await tx.organization.findUnique({ where: { id: organizationId } })
  if (!organization)
    throw new AppException(
      'Organization unavailable',
      404,
      OrganizationMemberErrorCode.MEMBER_UNAVAILABLE
    )
  const member = await tx.orgMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { id: true, user: { select: { id: true, name: true, email: true, systemRole: true } } },
  })
  if (!member)
    throw new AppException(
      'Member unavailable',
      404,
      OrganizationMemberErrorCode.MEMBER_UNAVAILABLE
    )
  const limits = await preflight(tx, member.id)
  if (
    limits.roles > ACCESS_MAX_ROLES ||
    limits.links > ACCESS_MAX_LINKS ||
    limits.rules > ACCESS_MAX_UNIQUE_RULES ||
    limits.bytes > ACCESS_MAX_POLICY_BYTES
  )
    throw unavailable()
  const links = await tx.memberRole.findMany({
    where: { memberId: member.id },
    select: {
      role: {
        select: {
          id: true,
          name: true,
          isSystem: true,
          organizationId: true,
          permissions: {
            select: {
              permission: {
                select: {
                  id: true,
                  action: true,
                  subject: true,
                  conditions: true,
                  fields: true,
                  inverted: true,
                },
              },
            },
          },
        },
      },
    },
  })
  const roles: LoadedAccess['roles'] = []
  const ruleIdsByRole = new Map<string, string[]>()
  const rules = new Map<string, StoredPolicyRule>()
  let unsafeLinkCount = 0
  for (const { role } of links) {
    if (!safe(role, organizationId)) {
      unsafeLinkCount += 1
      continue
    }
    roles.push({ id: role.id, name: role.name, isSystem: role.isSystem })
    const ids = role.permissions.map(({ permission }) => permission.id).sort()
    ruleIdsByRole.set(role.id, ids)
    for (const { permission } of role.permissions) rules.set(permission.id, permission)
  }
  return {
    organization,
    member: {
      memberId: member.id,
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      systemRole: member.user.systemRole,
    },
    roles,
    ruleIdsByRole,
    rules,
    unsafeLinkCount,
  }
}
