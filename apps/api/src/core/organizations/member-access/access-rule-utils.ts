import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import type { AccessOperationBudget } from './access-budget'
import type { AccessCapability } from './access-capabilities'

/** Key-order independent JSON of a condition; `null` and `{}` both mean unconditional. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export const isUnconditional = (rule: AbilityPermission): boolean =>
  !rule.conditions || Object.keys(rule.conditions as object).length === 0

export const coversAnyField = (rule: AbilityPermission): boolean =>
  rule.fields.length === 0 || rule.fields.includes('*')

export const coversField = (rule: AbilityPermission, field: string): boolean =>
  coversAnyField(rule) || rule.fields.includes(field)

/** A rule that can say something about this capability: its subject (or all) and action (or manage). */
export const isRelevant = (rule: AbilityPermission, subject: string, action: string): boolean =>
  (rule.subject === subject || rule.subject === 'all') &&
  (rule.action === action || rule.action === 'manage')

export const relevantTo = (rule: AbilityPermission, capability: AccessCapability): boolean =>
  isRelevant(rule, capability.subject, capability.action)

/** Canonical condition text, computed once per distinct rule and paid for through the budget. */
export function conditionKeys(budget: AccessOperationBudget): (rule: AbilityPermission) => string {
  const cache = new Map<string, string>()
  return (rule) => {
    const cached = cache.get(rule.id)
    if (cached !== undefined) return cached
    budget.spend(1, 'canonical')
    const key = isUnconditional(rule) ? 'null' : canonicalJson(rule.conditions)
    cache.set(rule.id, key)
    return key
  }
}
