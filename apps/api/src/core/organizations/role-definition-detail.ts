import {
  type AdvancedRule,
  type ManagedPreset,
  ROLE_EDITABLE_RULE_LIMIT,
  ROLE_HOLDER_SAMPLE_LIMIT,
  ROLE_MANAGED_PERMISSION_IDS_LIMIT,
  ROLE_RULE_BYTES_LIMIT,
  type RoleDefinitionDetail,
  type RoleMeta,
  serializedJsonBytes,
} from '@amcore/shared'

import { classifyStoredRule, presetKey, type StoredRule } from './role-definition-classifier'

import { Prisma } from '@/generated/prisma/client'

export interface RulePreflight {
  ruleCount: number
  ruleBytes: number
  fullControl: boolean
}

/**
 * Metadata-only RESULT per role: rule count, serialized-rule bytes and the configured full-control flag.
 * It selects no payload rows, so oversized roles are recognized before any rule JSON is materialized.
 * (PostgreSQL still measures `conditions::text`; the cost is a documented implementation gate.)
 */
export async function rulePreflight(
  tx: Prisma.TransactionClient,
  roleIds: string[]
): Promise<Map<string, RulePreflight>> {
  const result = new Map<string, RulePreflight>(
    roleIds.map((id) => [id, { ruleCount: 0, ruleBytes: 0, fullControl: false }])
  )
  if (roleIds.length === 0) return result
  const rows = await tx.$queryRaw<
    { roleId: string; ruleCount: number; ruleBytes: number; fullControl: boolean }[]
  >(Prisma.sql`
    SELECT rp."roleId" AS "roleId",
           count(*)::int AS "ruleCount",
           LEAST(COALESCE(SUM(COALESCE(octet_length(p.conditions::text), 0)
             + COALESCE(octet_length(array_to_string(p.fields, ',')), 0)), 0), 2147483647)::int AS "ruleBytes",
           COALESCE(bool_or(p.subject = 'TeamAccess' AND p.action = 'manage' AND NOT p.inverted), false) AS "fullControl"
      FROM core.role_permissions rp
      JOIN core.permissions p ON p.id = rp."permissionId"
     WHERE rp."roleId" = ANY(${roleIds}::text[])
     GROUP BY rp."roleId"`)
  for (const row of rows) {
    result.set(row.roleId, {
      ruleCount: row.ruleCount,
      ruleBytes: row.ruleBytes,
      fullControl: row.fullControl,
    })
  }
  return result
}

/**
 * The ACTUAL advanced-rule projection (not the SQL estimate) must fit its budget; an editor must
 * never present a role whose rules were silently discarded as editable.
 */
export const projectionOversized = (rules: StoredRule[]): boolean =>
  serializedJsonBytes(splitRules(rules).advanced) > ROLE_RULE_BYTES_LIMIT

export const isOversized = (preflight: RulePreflight): boolean =>
  preflight.ruleCount > ROLE_EDITABLE_RULE_LIMIT || preflight.ruleBytes > ROLE_RULE_BYTES_LIMIT

const ruleSelect = {
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
} as const

/** Rows of one role in a deterministic order (permission id ascending). */
export async function loadRoleRules(
  tx: Prisma.TransactionClient,
  roleId: string
): Promise<StoredRule[]> {
  const links = await tx.rolePermission.findMany({
    where: { roleId },
    select: ruleSelect,
    orderBy: { permissionId: 'asc' },
    take: ROLE_EDITABLE_RULE_LIMIT + 1,
  })
  return links.map(({ permission }) => permission)
}

export interface RuleSplit {
  managed: ManagedPreset[]
  advanced: AdvancedRule[]
}

/** Split stored rules into editor-managed presets (grouped, duplicates counted) and advanced rules. */
export function splitRules(rules: StoredRule[]): RuleSplit {
  const managed = new Map<string, ManagedPreset>()
  const advanced: AdvancedRule[] = []
  for (const rule of rules) {
    const kind = classifyStoredRule(rule)
    if (kind.kind === 'preset') {
      const key = presetKey(kind)
      const existing = managed.get(key)
      if (existing) {
        existing.duplicateCount += 1
        if (existing.permissionIds.length < ROLE_MANAGED_PERMISSION_IDS_LIMIT)
          existing.permissionIds.push(rule.id)
      } else {
        managed.set(key, {
          capabilityId: kind.capabilityId,
          presetId: kind.presetId,
          permissionIds: [rule.id],
          duplicateCount: 0,
        })
      }
    } else {
      advanced.push({
        permissionId: rule.id,
        action: rule.action,
        subject: rule.subject,
        conditions: (rule.conditions ?? null) as AdvancedRule['conditions'],
        fields: [...rule.fields],
        inverted: rule.inverted,
      })
    }
  }
  return {
    managed: [...managed.values()].sort((a, b) =>
      presetKey(a) < presetKey(b) ? -1 : presetKey(a) > presetKey(b) ? 1 : 0
    ),
    advanced,
  }
}

export interface DetailInput {
  orgId: string
  role: RoleMeta
  aclVersion: number
  actorUserId: string
  now: Date
  preflight: RulePreflight
}

/**
 * Build the complete detail from ONE transaction's state (read snapshot or the write transaction
 * before commit). Holder counts are this organization's memberships only, never a cross-tenant count.
 */
export async function buildRoleDetail(
  tx: Prisma.TransactionClient,
  input: DetailInput
): Promise<RoleDefinitionDetail> {
  const { orgId, role, preflight } = input
  const memberWhere = { roleId: role.id, member: { organizationId: orgId } }
  const [holderTotal, sample, selfHolds, liveInvitationCount] = await Promise.all([
    tx.memberRole.count({ where: memberWhere }),
    tx.memberRole.findMany({
      where: memberWhere,
      orderBy: { memberId: 'asc' },
      take: ROLE_HOLDER_SAMPLE_LIMIT,
      select: {
        member: { select: { id: true, user: { select: { id: true, name: true, email: true } } } },
      },
    }),
    tx.memberRole.count({
      where: { ...memberWhere, member: { organizationId: orgId, userId: input.actorUserId } },
    }),
    tx.orgInviteRoleIntent.count({
      where: {
        liveRoleId: role.id,
        invite: {
          organizationId: orgId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
      },
    }),
  ])
  const oversized = !role.isSystem && isOversized(preflight)
  let managedPresets: ManagedPreset[] | null = null
  let advancedRules: AdvancedRule[] | null = null
  if (!oversized) {
    const split = splitRules(await loadRoleRules(tx, role.id))
    if (serializedJsonBytes(split.advanced) <= ROLE_RULE_BYTES_LIMIT) {
      managedPresets = split.managed
      advancedRules = split.advanced
    }
  }
  const editMode = role.isSystem
    ? 'system'
    : managedPresets === null || advancedRules === null
      ? 'oversized'
      : 'editable'
  return {
    role,
    aclVersion: input.aclVersion,
    editMode,
    selfHeld: selfHolds > 0,
    grantsFullControl: preflight.fullControl,
    ruleCount: preflight.ruleCount,
    managedPresets,
    advancedRules,
    holders: {
      total: holderTotal,
      sample: sample.map(({ member }) => ({
        memberId: member.id,
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
      })),
      truncated: holderTotal > sample.length,
    },
    impact: { liveInvitationCount },
  }
}
