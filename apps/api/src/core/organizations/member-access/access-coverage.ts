import { Action, Subject } from '@amcore/shared'

import type { AccessCapability } from './access-capabilities'
import type { StoredPolicyRule } from './access-facts'

const ORG_ACTIONS = new Set<string>([Action.Read, Action.Update, Action.Delete, Action.Manage])
/** Inverted rules on these subjects veto team administration whatever their action or fields. */
const TEAM_VETO_SUBJECTS = new Set<string>([
  Subject.User,
  Subject.Role,
  Subject.Permission,
  Subject.All,
])

/**
 * Is this stored rule explained by the summary? Covered: team access rules; organization rules for
 * the built-in actions; inverted rules on the team-veto subjects; and rules a configured capability
 * evaluates (exact subject, its action or `manage`, and fields that intersect what it knows).
 * Everything else is reported, never silently ignored: allow rules on `all`, unknown domains,
 * opt-out capabilities and rules whose fields no matching capability knows.
 */
export function isCovered(
  rule: StoredPolicyRule,
  configured: readonly AccessCapability[]
): boolean {
  if (rule.subject === Subject.TeamAccess) return true
  if (rule.subject === Subject.Organization) return ORG_ACTIONS.has(rule.action)
  if (rule.inverted && TEAM_VETO_SUBJECTS.has(rule.subject)) return true
  const limited = rule.fields.length > 0 && !rule.fields.includes('*')
  return configured.some((capability) => {
    if (rule.subject !== capability.subject) return false
    if (rule.action !== capability.action && rule.action !== Action.Manage) return false
    if (!limited) return true
    const known = new Set([...capability.editableFields, ...capability.requiredReadFields])
    return rule.fields.some((field) => known.has(field))
  })
}
