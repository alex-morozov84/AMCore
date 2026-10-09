import type { AccessConfiguredItem } from '@amcore/shared'

import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import type { ItemSpec } from './access-capabilities'
import type { Prerequisite, PrerequisiteCheck } from './access-prerequisites'
import { isUnconditional } from './access-rule-utils'
import { roleRefs } from './access-sources'
import { type Classified, KIND_ORDER } from './configured-areas'
import { denyCovers, type Masking, type Scan } from './configured-scan'

type RuleSource = Extract<AccessConfiguredItem['sources'][number], { kind: 'rule' }>

const STATUS_ORDER = { vetoes: 0, restricts: 1, contributes: 2, overridden: 3 } as const

export interface SourceInput {
  spec: ItemSpec
  scan: Scan
  masking: Masking
  kindOf: ReadonlyMap<string, Classified>
  prereqOf: ReadonlyMap<string, Prerequisite>
  prerequisite: PrerequisiteCheck
  rolesByRule: ReadonlyMap<string, readonly string[]>
}

/** Every rule that decided or limited the item, most decisive first; the caller shows the first few. */
export function collectSources(input: SourceInput): RuleSource[] {
  const { spec, scan, masking, kindOf, prereqOf, prerequisite, rolesByRule } = input
  const statusOf = (rule: AbilityPermission): RuleSource['status'] => {
    if (!rule.inverted) return masking.masked.has(rule.id) ? 'overridden' : 'contributes'
    const decisive =
      (isUnconditional(rule) && denyCovers(rule, scan.itemFields)) || masking.maskers.has(rule.id)
    return decisive ? 'vetoes' : 'restricts'
  }
  const build = (rule: AbilityPermission, via: RuleSource['via']): RuleSource => {
    const detail = rule.inverted ? undefined : kindOf.get(rule.id)
    return {
      kind: 'rule',
      via,
      ...(spec.field !== undefined && via === 'direct' && { field: spec.field }),
      roleIds: roleRefs(rolesByRule.get(rule.id) ?? []).roleIds,
      permissionId: rule.id,
      presetId: detail?.presetId ?? null,
      effect: rule.inverted ? 'deny' : 'allow',
      status: via === 'direct' ? statusOf(rule) : 'vetoes',
      area: detail?.kind ?? null,
      prerequisite: rule.inverted ? null : (prereqOf.get(rule.id) ?? null),
    }
  }
  return [
    ...scan.relevant.map((rule) => build(rule, 'direct')),
    ...prerequisite.readDenies.map((rule) => build(rule, 'readPrerequisite')),
    ...prerequisite.teamVeto.map((rule) => build(rule, 'teamAccessVeto')),
  ].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      KIND_ORDER.indexOf(a.area ?? 'custom') - KIND_ORDER.indexOf(b.area ?? 'custom') ||
      (a.permissionId < b.permissionId ? -1 : a.permissionId > b.permissionId ? 1 : 0)
  )
}
