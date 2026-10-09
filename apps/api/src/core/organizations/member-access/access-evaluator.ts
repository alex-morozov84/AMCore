import {
  ACCESS_COUNTERFACTUAL_MAX_ROLES,
  ACCESS_COUNTERFACTUAL_MAX_RULES,
  ACCESS_ROLES_SHOWN,
  ACCESS_UNCOVERED_ROLE_SAMPLE,
  type AccessConfiguredItem,
  type AccessRecordItem,
  type MemberAccess,
  type RequestPrincipal,
  type SystemRole,
} from '@amcore/shared'

import type { CapabilityRegistry } from '../capability-registry.service'

import { type AccessOperationBudget, AccessOperationBudget as Budget } from './access-budget'
import {
  type AccessCapability,
  assertCatalogueWithinLimits,
  defaultCapabilities,
  type ItemSpec,
  itemSpecs,
} from './access-capabilities'
import { isCovered } from './access-coverage'
import { AccessPolicy, exactCapabilityIds, type StoredPolicyRule } from './access-facts'
import { roleRefs, sourcesFor } from './access-sources'
import { evaluateConfigured } from './configured-access'

import type { Organization } from '@/generated/prisma/client'

type Item = MemberAccess['items'][number]

export interface AccessInput {
  organization: Organization
  member: {
    memberId: string
    userId: string
    name: string | null
    email: string
    systemRole: string
  }
  /** Roles that count toward authority (same organization or a system template). */
  roles: { id: string; name: string; isSystem: boolean }[]
  ruleIdsByRole: ReadonlyMap<string, readonly string[]>
  rules: ReadonlyMap<string, StoredPolicyRule>
  unsafeLinkCount: number
  registry: CapabilityRegistry
  /** The registered capabilities; defaults to the catalogue and its adapters. */
  capabilities?: readonly AccessCapability[]
  /** Counts every internal check; defaults to the per-request limit. */
  budget?: AccessOperationBudget
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Explains what the member can do in this organization, from the real policy. Built-in operations
 * get exact current-row decisions from the whole validated rule set; the single-role questions (who
 * alone would grant, who widens) are extra work and are skipped, reported as unknown, above the
 * counterfactual caps. Every other registered capability is explained as what the role settings
 * configure (areas), and never as proof for one record.
 */
export function explainAccess(input: AccessInput): MemberAccess {
  const { organization, member, roles, ruleIdsByRole, rules, registry } = input
  const capabilities = input.capabilities ?? defaultCapabilities()
  assertCatalogueWithinLimits(capabilities)
  const budget = input.budget ?? new Budget()
  const specs = itemSpecs(capabilities, exactCapabilityIds(registry, organization))
  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: member.userId,
    email: member.email,
    systemRole: member.systemRole as SystemRole,
    organizationId: organization.id,
    aclVersion: organization.aclVersion,
  }
  const policy = new AccessPolicy(
    rules,
    principal,
    organization,
    registry,
    specs.filter((spec) => spec.mode === 'record'),
    budget
  )
  const allIds = [...new Set(roles.flatMap((role) => ruleIdsByRole.get(role.id) ?? []))].sort()
  const factsAll = policy.facts(allIds)
  const hints = policy.hints(allIds)
  const counterfactual =
    roles.length <= ACCESS_COUNTERFACTUAL_MAX_ROLES && rules.size <= ACCESS_COUNTERFACTUAL_MAX_RULES
  const single = counterfactual
    ? new Map(roles.map((role) => [role.id, policy.facts(ruleIdsByRole.get(role.id) ?? [])]))
    : undefined
  const rolesByRule = new Map<string, string[]>()
  for (const [roleId, ids] of ruleIdsByRole)
    for (const id of ids) rolesByRule.set(id, [...(rolesByRule.get(id) ?? []), roleId])
  const normalized = policy.normalized(allIds)
  const context = { policy: normalized, rolesByRule, stored: rules, organization }
  const configuredContext = { policy: normalized, rolesByRule, stored: rules, budget }
  const lastOperation = new Map<string, string>()
  const items = specs.flatMap((spec): Item[] => {
    if (spec.mode === 'notEvaluated') return [notEvaluatedItem(spec)]
    if (spec.mode === 'configured') {
      const configured = evaluateConfigured(spec, configuredContext)
      // A per-field line is kept only when it says something the operation does not.
      if (spec.field === undefined) lastOperation.set(spec.capability.id, signature(configured))
      else if (lastOperation.get(spec.capability.id) === signature(configured)) return []
      return [configured]
    }
    if (spec.baseline) return [baselineItem(spec, hints)]
    budget.spend(normalized.length, 'relevance')
    return [
      recordItem(spec, factsAll[spec.key] ?? false, hints, single, context, roles, (blocked) =>
        policy.facts(allIds.filter((id) => !blocked.has(id)))
      ),
    ]
  })
  return {
    member: {
      memberId: member.memberId,
      userId: member.userId,
      name: member.name,
      email: member.email,
    },
    aclVersion: organization.aclVersion,
    scope: 'organization-membership',
    roles: roleList(roles),
    unsafeLinkCount: input.unsafeLinkCount,
    items,
    widening: widening(items, single, roles),
    uncovered: uncovered(
      rules,
      roles,
      ruleIdsByRole,
      specs.filter((spec) => spec.mode === 'configured' && !spec.field).map((s) => s.capability)
    ),
    qualifiers: member.systemRole === 'SUPER_ADMIN' ? ['platformSuperAdmin'] : [],
  }
}

/** What makes a configured field line redundant: the same state, areas and limits as its operation. */
function signature(item: AccessConfiguredItem): string {
  return JSON.stringify([
    item.state,
    item.areas.map((area) => [area.kind, area.masked, area.prerequisite, area.absorbed]),
    item.limits.map((limit) => limit.kind),
  ])
}

function notEvaluatedItem(spec: ItemSpec): Item {
  return {
    key: spec.key,
    evaluation: 'notEvaluated',
    baseline: false,
    reason: 'optOut',
    sources: [],
    sourcesTruncated: false,
  }
}

function baselineItem(spec: ItemSpec, hints: Record<string, string>): AccessRecordItem {
  return {
    key: spec.key,
    evaluation: 'record',
    baseline: true,
    granted: true,
    reason: 'granted',
    actorHint: (hints[spec.capability.id] as AccessRecordItem['actorHint']) ?? 'allowed',
    origin: null,
    reachedBy: null,
    grantedBy: null,
    vetoedBy: null,
    sources: [{ kind: 'membership' }],
    sourcesTruncated: false,
  }
}

function recordItem(
  spec: ItemSpec,
  granted: boolean,
  hints: Record<string, string>,
  single: Map<string, Record<string, boolean>> | undefined,
  context: Parameters<typeof sourcesFor>[2],
  roles: AccessInput['roles'],
  withoutRules: (blocked: ReadonlySet<string>) => Record<string, boolean>
): AccessRecordItem {
  const found = sourcesFor(spec, granted, context)
  const common = {
    key: spec.key,
    evaluation: 'record' as const,
    baseline: false,
    granted,
    actorHint: spec.field
      ? null
      : ((hints[spec.capability.id] as AccessRecordItem['actorHint']) ?? null),
    sources: found.sources,
    sourcesTruncated: found.truncated,
  }
  if (!single)
    return {
      ...common,
      reason: granted ? 'granted' : null,
      origin: null,
      reachedBy: null,
      grantedBy: null,
      vetoedBy: null,
    }
  const alone = roles.filter((role) => single.get(role.id)?.[spec.key]).map((role) => role.id)
  if (granted)
    return {
      ...common,
      reason: 'granted',
      origin: alone.length > 0 ? 'single' : 'combined',
      reachedBy: roleRefs(alone),
      grantedBy: null,
      vetoedBy: null,
    }
  // Blocked means: it would be granted without the blocking rules. A single role that would grant it
  // alone proves that for any capability; the rule-level check also covers an ability that needs
  // several roles together (one gives delete, another gives team control) and is blocked.
  const vetoed =
    alone.length > 0 ||
    (found.vetoRules.length > 0 && withoutRules(new Set(found.vetoRules))[spec.key] === true)
  return {
    ...common,
    reason: vetoed ? 'vetoed' : found.directAllow ? 'missingPrerequisite' : 'noGrant',
    origin: null,
    reachedBy: null,
    grantedBy: roleRefs(alone),
    vetoedBy: vetoed ? roleRefs(found.vetoRoles) : null,
  }
}

function widening(
  items: Item[],
  single: Map<string, Record<string, boolean>> | undefined,
  roles: AccessInput['roles']
): MemberAccess['widening'] {
  const exact = items.filter((entry): entry is AccessRecordItem => entry.evaluation === 'record')
  const base = {
    scope: 'exactItems' as const,
    excludedItems: items.length - exact.length,
  }
  if (!single)
    return {
      ...base,
      status: 'unavailable',
      reason: roles.length > ACCESS_COUNTERFACTUAL_MAX_ROLES ? 'roleLimit' : 'ruleLimit',
      breadth: null,
      synergy: null,
      vetoed: null,
    }
  const keys = exact.filter((entry) => !entry.baseline).map((entry) => entry.key)
  const granted = new Set(
    exact.filter((entry) => !entry.baseline && entry.granted).map((e) => e.key)
  )
  const exceeds = (facts: Record<string, boolean>): boolean => {
    const own = keys.filter((key) => facts[key])
    return own.every((key) => granted.has(key)) && granted.size > own.length
  }
  return {
    ...base,
    status: 'computed',
    breadth: granted.size > 0 && roles.every((role) => exceeds(single.get(role.id) ?? {})),
    synergy: exact.some((entry) => entry.origin === 'combined'),
    vetoed: exact.some((entry) => entry.vetoedBy !== null),
  }
}

function roleList(roles: AccessInput['roles']): MemberAccess['roles'] {
  const ordered = [...roles].sort(
    (a, b) =>
      Number(b.isSystem) - Number(a.isSystem) ||
      compareText(a.name, b.name) ||
      compareText(a.id, b.id)
  )
  return {
    total: ordered.length,
    items: ordered.slice(0, ACCESS_ROLES_SHOWN),
    truncated: ordered.length > ACCESS_ROLES_SHOWN,
  }
}

function uncovered(
  rules: ReadonlyMap<string, StoredPolicyRule>,
  roles: AccessInput['roles'],
  ruleIdsByRole: ReadonlyMap<string, readonly string[]>,
  configured: readonly AccessCapability[]
): MemberAccess['uncovered'] {
  const outside = new Set(
    [...rules.values()].filter((rule) => !isCovered(rule, configured)).map((rule) => rule.id)
  )
  const holders = roles
    .filter((role) => (ruleIdsByRole.get(role.id) ?? []).some((id) => outside.has(id)))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
  return {
    ruleCount: outside.size,
    roleSample: holders
      .slice(0, ACCESS_UNCOVERED_ROLE_SAMPLE)
      .map((role) => ({ id: role.id, name: role.name })),
  }
}
