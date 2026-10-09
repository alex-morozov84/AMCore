import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import type { AccessOperationBudget } from './access-budget'
import type { ItemSpec } from './access-capabilities'
import { coversAnyField, coversField, isRelevant, isUnconditional } from './access-rule-utils'
import { DenyIndex } from './configured-mask-index'

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
  const unconditional = new DenyIndex()
  const conditional = new Map<string, DenyIndex>()
  for (const deny of scan.denies) {
    if (isUnconditional(deny)) unconditional.add(deny)
    else {
      const condition = key(deny)
      const index = conditional.get(condition) ?? new DenyIndex()
      index.add(deny)
      conditional.set(condition, index)
    }
  }
  const masked = new Set<string>()
  for (const rule of scan.allows) {
    const matching = conditional.get(key(rule))
    const covered = coveredBy(rule, scan.itemFields)
    const cancelled =
      covered === null
        ? unconditional.all || matching?.all
        : covered.every((name) => unconditional.covers(name) || matching?.covers(name))
    if (cancelled) {
      masked.add(rule.id)
      unconditional.use(covered)
      matching?.use(covered)
    }
  }
  return {
    unconditionalDenies: unconditional.rules,
    conditionalByKey: new Map(
      [...conditional].map(([condition, index]) => [condition, index.rules])
    ),
    masked,
    maskers: new Set([unconditional, ...conditional.values()].flatMap((index) => index.maskers())),
    globalBlock:
      scan.itemFields === null
        ? unconditional.all
        : scan.itemFields.every((name) => unconditional.covers(name)),
    unmaskedRules: scan.allows.filter((rule) => !masked.has(rule.id)),
  }
}
