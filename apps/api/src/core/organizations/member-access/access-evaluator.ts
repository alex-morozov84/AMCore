import {
  ACCESS_COUNTERFACTUAL_MAX_ROLES,
  ACCESS_COUNTERFACTUAL_MAX_RULES,
  ACCESS_ROLES_SHOWN,
  ACCESS_UNCOVERED_ROLE_SAMPLE,
  Action,
  type MemberAccess,
  type RequestPrincipal,
  Subject,
  type SystemRole,
} from '@amcore/shared'

import type { CapabilityRegistry } from '../capability-registry.service'

import { AccessPolicy, type ItemSpec, itemSpecs, type StoredPolicyRule } from './access-facts'
import { roleRefs, sourcesFor } from './access-sources'

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
}

const ORG_ACTIONS = new Set<string>([Action.Read, Action.Update, Action.Delete, Action.Manage])

/** Rules this summary does not explain: anything that is not an organization/team rule or a veto. */
function isUncovered(rule: StoredPolicyRule): boolean {
  if (rule.subject === Subject.TeamAccess) return false
  if (rule.subject === Subject.Organization) return !ORG_ACTIONS.has(rule.action)
  return !rule.inverted
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Explains what the member can do in this organization, from the real policy. Exact decisions come
 * from the whole validated rule set; the single-role questions (who alone would grant, who widens)
 * are extra work and are skipped, reported as unknown, above the counterfactual caps.
 */
export function explainAccess(input: AccessInput): MemberAccess {
  const { organization, member, roles, ruleIdsByRole, rules, registry } = input
  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: member.userId,
    email: member.email,
    systemRole: member.systemRole as SystemRole,
    organizationId: organization.id,
    aclVersion: organization.aclVersion,
  }
  const policy = new AccessPolicy(rules, principal, organization, registry)
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
  const context = {
    policy: policy.normalized(allIds),
    rolesByRule,
    stored: rules,
    organization,
  }
  const items = itemSpecs().map((spec) =>
    spec.baseline
      ? baselineItem(spec, hints)
      : item(spec, factsAll[spec.key] ?? false, hints, single, context, roles)
  )
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
    widening: widening(items, single, roles, rules.size),
    uncovered: uncovered(rules, roles, ruleIdsByRole),
    qualifiers: member.systemRole === 'SUPER_ADMIN' ? ['platformSuperAdmin'] : [],
  }
}

function baselineItem(spec: ItemSpec, hints: Record<string, string>): Item {
  return {
    key: spec.key,
    baseline: true,
    granted: true,
    reason: 'granted',
    actorHint: (hints[spec.capabilityId] as Item['actorHint']) ?? 'allowed',
    origin: null,
    reachedBy: null,
    grantedBy: null,
    vetoedBy: null,
    sources: [{ kind: 'membership' }],
    sourcesTruncated: false,
  }
}

function item(
  spec: ItemSpec,
  granted: boolean,
  hints: Record<string, string>,
  single: Map<string, Record<string, boolean>> | undefined,
  context: Parameters<typeof sourcesFor>[2],
  roles: AccessInput['roles']
): Item {
  const found = sourcesFor(spec, granted, context)
  const common = {
    key: spec.key,
    baseline: false,
    granted,
    actorHint: spec.field ? null : ((hints[spec.capabilityId] as Item['actorHint']) ?? null),
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
  const vetoed = alone.length > 0
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
  roles: AccessInput['roles'],
  ruleCount: number
): MemberAccess['widening'] {
  if (!single)
    return {
      status: 'unavailable',
      reason: roles.length > ACCESS_COUNTERFACTUAL_MAX_ROLES ? 'roleLimit' : 'ruleLimit',
      breadth: null,
      synergy: null,
      vetoed: null,
    }
  void ruleCount
  const keys = items.filter((entry) => !entry.baseline).map((entry) => entry.key)
  const granted = new Set(
    items.filter((entry) => !entry.baseline && entry.granted).map((e) => e.key)
  )
  const exceeds = (facts: Record<string, boolean>): boolean => {
    const own = keys.filter((key) => facts[key])
    return own.every((key) => granted.has(key)) && granted.size > own.length
  }
  return {
    status: 'computed',
    breadth: granted.size > 0 && roles.every((role) => exceeds(single.get(role.id) ?? {})),
    synergy: items.some((entry) => entry.origin === 'combined'),
    vetoed: items.some((entry) => entry.vetoedBy !== null),
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
  ruleIdsByRole: ReadonlyMap<string, readonly string[]>
): MemberAccess['uncovered'] {
  const outside = new Set([...rules.values()].filter(isUncovered).map((rule) => rule.id))
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
