import {
  ACCESS_CONFIGURED_SOURCES_PER_ITEM,
  type AccessArea,
  type AccessConfiguredItem,
  type AccessLimit,
  configuredInvariants,
} from '@amcore/shared'

import type { AbilityPermission } from '../../auth/casl/permission-normalization'

import { type AccessOperationBudget, AccessUnavailableError } from './access-budget'
import type { ItemSpec } from './access-capabilities'
import type { StoredPolicyRule } from './access-facts'
import { type Prerequisite, prerequisiteCheck } from './access-prerequisites'
import { conditionKeys } from './access-rule-utils'
import { roleRefs } from './access-sources'
import { areaLimits, buildAreas, classifier, denyLimits } from './configured-areas'
import { type Masking, maskRules, type Scan, scanRules } from './configured-scan'
import { collectSources } from './configured-sources'

export interface ConfiguredContext {
  /** The whole policy after validation, interpolation and ordering. */
  policy: readonly AbilityPermission[]
  rolesByRule: ReadonlyMap<string, readonly string[]>
  /** Rules as stored (uninterpolated), for preset recognition. */
  stored: ReadonlyMap<string, StoredPolicyRule>
  budget: AccessOperationBudget
  conditionKey?: (rule: AbilityPermission) => string
}

const dedupe = (limits: AccessLimit[]): AccessLimit[] => [
  ...new Map(limits.map((limit) => [limit.kind, limit])).values(),
]

/** An item that breaks its own state matrix is never served. */
function check(item: AccessConfiguredItem): AccessConfiguredItem {
  if (configuredInvariants(item)) throw new AccessUnavailableError('unexpected')
  return item
}

const itemOf = (key: string, over: Partial<AccessConfiguredItem>): AccessConfiguredItem =>
  check({
    key,
    evaluation: 'configured',
    baseline: false,
    state: 'none',
    areas: [],
    limits: [],
    blockedBy: null,
    sources: [],
    sourcesTruncated: false,
    ...over,
  })

/** Who blocks the item: an unconditional deny, a deny that masked every area or a blocked prerequisite. */
function blockersOf(
  scan: Scan,
  masking: Masking,
  byPrerequisite: boolean,
  prerequisiteBlockers: AbilityPermission[]
): AbilityPermission[] {
  if (masking.globalBlock) return masking.unconditionalDenies
  if (byPrerequisite) return prerequisiteBlockers
  return scan.denies.filter((deny) => masking.maskers.has(deny.id))
}

/**
 * What the role settings configure for a capability the registry has no exact answer for. It
 * answers by independent areas and never claims the right holds for a particular record. Every
 * calculation uses all rules; only afterwards are the displayed sources limited.
 */
export function evaluateConfigured(spec: ItemSpec, ctx: ConfiguredContext): AccessConfiguredItem {
  const { capability } = spec
  const { policy, budget } = ctx
  const key = ctx.conditionKey ?? conditionKeys(budget)
  const scan = scanRules(spec, policy, budget)
  if (scan.allows.length === 0) return itemOf(spec.key, {})

  const masking = maskRules(scan, key, budget)
  const prerequisite = prerequisiteCheck(capability, policy, key, budget)
  const classify = classifier(capability, ctx.stored)
  const kindOf = new Map(scan.allows.map((rule) => [rule.id, classify(rule)]))
  const prereqOf = new Map<string, Prerequisite>(
    scan.allows.map((rule) => [rule.id, prerequisite.of(rule)])
  )
  budget.spend(scan.allows.length, 'aggregate')
  const areas = buildAreas(scan, masking, kindOf, prereqOf, ctx.rolesByRule)
  const unmasked = areas.filter((area) => !area.masked)
  const limits = dedupe([...areaLimits(unmasked), ...denyLimits(scan, masking)])
  const sources = collectSources({
    spec,
    scan,
    masking,
    kindOf,
    prereqOf,
    prerequisite,
    rolesByRule: ctx.rolesByRule,
    budget,
  })
  const shown = {
    sources: sources.slice(0, ACCESS_CONFIGURED_SOURCES_PER_ITEM),
    sourcesTruncated:
      sources.length > ACCESS_CONFIGURED_SOURCES_PER_ITEM ||
      sources.some((source) => (source.total ?? source.roleIds.length) > source.roleIds.length),
  }
  const byPrerequisite = unmasked.length > 0 && unmasked.every((a) => a.prerequisite === 'blocked')
  const decision = decide(areas, unmasked, limits, masking, byPrerequisite)

  if (decision === 'blocked')
    return itemOf(spec.key, {
      ...shown,
      state: 'blocked',
      areas,
      limits,
      blockedBy: roleRefs(
        blockersOf(scan, masking, byPrerequisite, prerequisite.blockers).flatMap(
          (rule) => ctx.rolesByRule.get(rule.id) ?? []
        )
      ),
    })
  if (decision === 'allowed')
    return itemOf(spec.key, {
      ...shown,
      state: 'allowed',
      areas: absorbOthers(areas),
    })
  return itemOf(spec.key, { ...shown, state: decision, areas, limits })
}

type Decision = Exclude<AccessConfiguredItem['state'], 'none'>

/**
 * The state, in precedence order: blocked, missing prerequisite, allowed (an unlimited area `all`
 * with a proven prerequisite and no limit or mask applying to it), otherwise configured.
 */
function decide(
  areas: readonly AccessArea[],
  unmasked: readonly AccessArea[],
  limits: readonly AccessLimit[],
  masking: Masking,
  byPrerequisite: boolean
): Decision {
  if (masking.globalBlock || areas.every((area) => area.masked) || byPrerequisite) return 'blocked'
  if (unmasked.every((area) => area.prerequisite === 'missing')) return 'missingPrerequisite'
  const open = unmasked.some(
    (area) =>
      area.kind === 'all' &&
      area.fields === null &&
      (area.prerequisite === 'met' || area.prerequisite === 'notRequired')
  )
  const denied = limits.some(
    (limit) => limit.kind === 'denyCondition' || limit.kind === 'denyFields'
  )
  return open && !denied && !areas.some((area) => area.masked) ? 'allowed' : 'configured'
}

/** In an allowed item the unlimited area `all` decides; every other area is informational. */
function absorbOthers(areas: readonly AccessArea[]): AccessArea[] {
  const open = areas.find(
    (area) =>
      area.kind === 'all' &&
      !area.masked &&
      area.fields === null &&
      (area.prerequisite === 'met' || area.prerequisite === 'notRequired')
  )
  return areas.map((area) => (area === open ? area : { ...area, absorbed: true }))
}
