import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import type { AccessOperationBudget } from './access-budget'
import type { ItemSpec } from './access-capabilities'
import { coversAnyField, coversField, isRelevant, isUnconditional } from './access-rule-utils'

/** The rules that can say something about one item, split by effect. */
export interface Scan {
  /** The fields the item is about: one field, the editable fields, or `null` for "any field". */
  itemFields: readonly string[] | null
  relevant: AbilityPermission[]
  allows: AbilityPermission[]
  denies: AbilityPermission[]
}

export function scanRules(
  spec: ItemSpec,
  policy: readonly AbilityPermission[],
  budget: AccessOperationBudget
): Scan {
  const { capability, field } = spec
  const itemFields: readonly string[] | null = field
    ? [field]
    : capability.editableFields.length > 0
      ? capability.editableFields
      : null
  budget.spend(policy.length, 'relevance')
  const touches = (rule: AbilityPermission): boolean =>
    itemFields === null || itemFields.some((name) => coversField(rule, name))
  const relevant = policy.filter(
    (rule) => isRelevant(rule, capability.subject, capability.action) && touches(rule)
  )
  return {
    itemFields,
    relevant,
    allows: relevant.filter((rule) => !rule.inverted),
    denies: relevant.filter((rule) => rule.inverted),
  }
}

/** What the denies do to the allows: which are cancelled, by whom, and which still apply. */
export interface Masking {
  unconditionalDenies: AbilityPermission[]
  /** Conditional denies, by canonical condition. */
  conditionalByKey: Map<string, AbilityPermission[]>
  masked: Set<string>
  maskers: Set<string>
  /** An unconditional deny covers every field of the item. */
  globalBlock: boolean
  unmaskedRules: AbilityPermission[]
}

/** The fields of the item a rule covers; `null` = every field. */
function coveredBy(
  rule: AbilityPermission,
  itemFields: Scan['itemFields']
): readonly string[] | null {
  if (itemFields === null) return coversAnyField(rule) ? null : rule.fields
  return itemFields.filter((name) => coversField(rule, name))
}

/** Whether the fields of an unconditional deny reach every wanted field. */
export function denyCovers(deny: AbilityPermission, wanted: Scan['itemFields']): boolean {
  return wanted === null ? coversAnyField(deny) : wanted.every((name) => coversField(deny, name))
}

/** Whether the union of the denies covers every wanted field. */
function unionCovers(denies: readonly AbilityPermission[], wanted: Scan['itemFields']): boolean {
  if (wanted === null) return denies.some(coversAnyField)
  return wanted.every((name) => denies.some((deny) => coversField(deny, name)))
}

/**
 * A deny hides an allow it covers when it is unconditional or has the identical condition. Nothing
 * is solved: other conditional denies stay limits.
 */
export function maskRules(
  scan: Scan,
  key: (rule: AbilityPermission) => string,
  budget: AccessOperationBudget
): Masking {
  budget.spend(scan.allows.length + scan.denies.length, 'mask')
  const unconditionalDenies = scan.denies.filter(isUnconditional)
  const conditionalByKey = new Map<string, AbilityPermission[]>()
  for (const deny of scan.denies.filter((rule) => !isUnconditional(rule)))
    conditionalByKey.set(key(deny), [...(conditionalByKey.get(key(deny)) ?? []), deny])
  const masked = new Set<string>()
  const maskers = new Set<string>()
  const covers = (deny: AbilityPermission, rule: AbilityPermission): boolean => {
    const covered = coveredBy(rule, scan.itemFields)
    return covered === null
      ? coversAnyField(deny)
      : covered.every((name) => coversField(deny, name))
  }
  for (const rule of scan.allows)
    for (const deny of [...unconditionalDenies, ...(conditionalByKey.get(key(rule)) ?? [])])
      if (covers(deny, rule)) {
        masked.add(rule.id)
        maskers.add(deny.id)
      }
  return {
    unconditionalDenies,
    conditionalByKey,
    masked,
    maskers,
    globalBlock: unionCovers(unconditionalDenies, scan.itemFields),
    unmaskedRules: scan.allows.filter((rule) => !masked.has(rule.id)),
  }
}
