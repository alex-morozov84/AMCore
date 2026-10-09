import type { AbilityPermission } from '../../auth/casl/permission-normalization'
import { hasFullTeamAccess } from '../../auth/casl/permission-normalization'

import type { AccessOperationBudget } from './access-budget'
import type { AccessCapability } from './access-capabilities'
import { coversField, isRelevant, isUnconditional } from './access-rule-utils'

export type Prerequisite = 'notRequired' | 'met' | 'unproven' | 'missing' | 'blocked'

const RANK: Record<Prerequisite, number> = {
  notRequired: 0,
  met: 1,
  unproven: 2,
  missing: 3,
  blocked: 4,
}
const worst = (a: Prerequisite, b: Prerequisite): Prerequisite => (RANK[a] >= RANK[b] ? a : b)

export interface PrerequisiteCheck {
  /** Prerequisite of one allow rule: its own condition against the required reads. */
  of: (rule: AbilityPermission) => Prerequisite
  /** Read deny rules that block a required field outright, and the team veto rules, for attribution. */
  blockers: AbilityPermission[]
  /** Read denies that are relevant to a required field, for the sources list. */
  readDenies: AbilityPermission[]
  teamVeto: AbilityPermission[]
}

const TEAM_VETO_SUBJECTS = new Set(['TeamAccess', 'Role', 'Permission', 'User', 'all'])

/**
 * Whether the reads (and the team gate) a capability needs are provable for an allow rule. Nothing
 * is solved: a read counts as proof only when it is unconditional or has the identical condition,
 * and any other read deny that touches a required field downgrades `met` to `unproven`.
 */
export function prerequisiteCheck(
  capability: AccessCapability,
  policy: readonly AbilityPermission[],
  key: (rule: AbilityPermission) => string,
  budget: AccessOperationBudget
): PrerequisiteCheck {
  const needsRead = capability.action !== 'read' && capability.requiredReadFields.length > 0
  // A read needs no read prerequisite of its own.
  const fields = needsRead ? capability.requiredReadFields : []
  const base: Prerequisite = needsRead || capability.teamAccess ? 'met' : 'notRequired'
  const readRules = needsRead
    ? policy.filter((rule) => isRelevant(rule, capability.subject, 'read'))
    : []
  budget.spend(policy.length + fields.length * (readRules.length + 1), 'prerequisite')
  const denies = readRules.filter((rule) => rule.inverted)
  const readDenies = denies.filter((rule) => fields.some((field) => coversField(rule, field)))
  const readBlockers = readDenies.filter(
    (rule) => isUnconditional(rule) && fields.some((field) => coversField(rule, field))
  )
  const team = teamState(capability, policy)
  const perField = fields.map((field) => {
    const deniedKeys = new Set(
      denies.filter((rule) => coversField(rule, field)).map((rule) => key(rule))
    )
    const allows = readRules.filter(
      (rule) => !rule.inverted && coversField(rule, field) && !deniedKeys.has(key(rule))
    )
    return {
      anyAllow: allows.length > 0,
      unconditional: allows.some(isUnconditional),
      keys: new Set(allows.map((rule) => key(rule))),
      denied: denies.some((rule) => coversField(rule, field)),
    }
  })
  return {
    blockers: [...readBlockers, ...(team.state === 'blocked' ? team.veto : [])],
    readDenies,
    teamVeto: team.state === 'blocked' ? team.veto : [],
    of: (rule) => {
      budget.spend(fields.length + 1, 'prerequisite')
      if (readBlockers.length > 0) return 'blocked'
      let result: Prerequisite = base
      if (team.state !== 'met') result = worst(result, team.state)
      for (const entry of perField) {
        if (!entry.anyAllow) result = worst(result, 'missing')
        else if (!(entry.unconditional || entry.keys.has(key(rule))) || entry.denied)
          result = worst(result, 'unproven')
      }
      return result
    },
  }
}

function teamState(
  capability: AccessCapability,
  policy: readonly AbilityPermission[]
): { state: 'met' | 'missing' | 'blocked'; veto: AbilityPermission[] } {
  if (!capability.teamAccess) return { state: 'met', veto: [] }
  if (hasFullTeamAccess([...policy])) return { state: 'met', veto: [] }
  const veto = policy.filter((rule) => rule.inverted && TEAM_VETO_SUBJECTS.has(rule.subject))
  const gate = policy.some(
    (rule) => !rule.inverted && rule.action === 'manage' && rule.subject === 'TeamAccess'
  )
  return gate && veto.length > 0 ? { state: 'blocked', veto } : { state: 'missing', veto: [] }
}

/** Aggregates the prerequisites of the unmasked rules of one area; only all-equal is certain. */
export function aggregatePrerequisite(values: readonly Prerequisite[]): Prerequisite {
  if (values.length === 0) return 'notRequired'
  for (const exact of ['notRequired', 'blocked', 'met', 'missing'] as const)
    if (values.every((value) => value === exact)) return exact
  return 'unproven'
}
