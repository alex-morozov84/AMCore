import type { AssignPermissionInput, RoleDefinitionPreset } from '@amcore/shared'

import { validatePermissionRule } from '../auth/casl/permission-rule-validation'

import { classifyStoredRule, presetKey, type StoredRule } from './role-definition-classifier'

import type { Prisma } from '@/generated/prisma/client'

type Tx = Prisma.TransactionClient

export interface PresetPlan {
  /** Permission ids of every classified row whose preset was deselected (all duplicates). */
  removeIds: string[]
  /** Presets to add: selected but not yet present; at most one fresh row each. */
  additions: RoleDefinitionPreset[]
  /** Number of distinct managed presets removed. */
  removedPresets: number
}

/**
 * Diff the persisted rules against the complete desired selection. Only classified (managed) rows
 * are ever removed; advanced, DENY and unrecognized rows are never part of the plan.
 */
export function planPresetChange(
  rules: StoredRule[],
  desired: Map<string, RoleDefinitionPreset>
): PresetPlan {
  const managed = new Map<string, string[]>()
  for (const rule of rules) {
    const kind = classifyStoredRule(rule)
    if (kind.kind === 'preset')
      managed.set(presetKey(kind), [...(managed.get(presetKey(kind)) ?? []), rule.id])
  }
  const removed = [...managed.entries()].filter(([key]) => !desired.has(key))
  return {
    removeIds: removed.flatMap(([, ids]) => ids),
    additions: [...desired.entries()]
      .filter(([key]) => !managed.has(key))
      .map(([, preset]) => preset),
    removedPresets: removed.length,
  }
}

/** Create one organization-scoped permission from a preset rule and link it to the role. */
export async function attachPreset(
  tx: Tx,
  orgId: string,
  roleId: string,
  rule: AssignPermissionInput
): Promise<void> {
  validatePermissionRule(rule)
  const permission = await tx.permission.create({
    data: {
      action: rule.action,
      subject: rule.subject,
      conditions: (rule.conditions as Prisma.InputJsonValue) ?? undefined,
      fields: rule.fields ?? [],
      inverted: rule.inverted ?? false,
      organizationId: orgId,
    },
  })
  await tx.rolePermission.create({ data: { roleId, permissionId: permission.id } })
}

/** Delete only unreferenced same-organization permission rows; a shared row keeps serving other roles. */
export async function collectOrphans(
  tx: Tx,
  orgId: string,
  permissionIds: string[]
): Promise<void> {
  if (permissionIds.length === 0) return
  await tx.permission.deleteMany({
    where: { id: { in: permissionIds }, organizationId: orgId, roles: { none: {} } },
  })
}

/** Detach only THIS role's links, then collect same-org rows no role still uses. */
export async function detachAndCollect(
  tx: Tx,
  orgId: string,
  roleId: string,
  permissionIds: string[]
): Promise<void> {
  await tx.rolePermission.deleteMany({ where: { roleId, permissionId: { in: permissionIds } } })
  await collectOrphans(tx, orgId, permissionIds)
}
