import type { RequestPrincipal } from '@amcore/shared'

import type { AppAbility, TeamAccessDecision } from '../../auth/casl/ability.factory'
import {
  type AbilityPermission,
  hasFullTeamAccess,
  normalizeOwnerPermissions,
} from '../../auth/casl/permission-normalization'
import { createPrismaAbility } from '../../auth/casl/prisma-ability'
import type { CapabilityRegistry } from '../capability-registry.service'

import { type AccessOperationBudget, AccessUnavailableError } from './access-budget'
import type { ItemSpec } from './access-capabilities'

import type { Organization } from '@/generated/prisma/client'

/** A stored rule as loaded; conditions stay the uninterpolated template. */
export type StoredPolicyRule = AbilityPermission

export type Facts = Record<string, boolean>

/**
 * Evaluates the real policy for the member: the same normalization, ability and registry the API
 * uses to authorize, so an explanation can never describe a rule set the server would not apply.
 * Only items with an exact current-row decision (`record`) are evaluated here; configured items
 * never enter these boolean facts, the single-role counterfactuals or widening.
 * Throws `invalidPolicy` when a stored rule is invalid; the caller turns that into
 * `ROLE_ACCESS_UNAVAILABLE`.
 */
export class AccessPolicy {
  private readonly cache = new Map<string, Facts>()

  constructor(
    private readonly rules: ReadonlyMap<string, StoredPolicyRule>,
    private readonly principal: RequestPrincipal,
    private readonly organization: Organization,
    private readonly registry: CapabilityRegistry,
    private readonly exactSpecs: readonly ItemSpec[],
    private readonly budget?: AccessOperationBudget
  ) {}

  private normalize(ruleIds: readonly string[]): AbilityPermission[] {
    const raw = ruleIds.map((id) => this.rules.get(id)!).filter(Boolean)
    try {
      return normalizeOwnerPermissions(raw, this.principal)
    } catch {
      throw new AccessUnavailableError('invalidPolicy')
    }
  }

  private context(ruleIds: readonly string[]): {
    owner: AbilityPermission[]
    team: boolean
    ability: AppAbility
    access: TeamAccessDecision
  } {
    const owner = this.normalize(ruleIds)
    const team = hasFullTeamAccess(owner)
    const rules = owner.map(({ action, subject, inverted, conditions, fields }) => ({
      action,
      subject,
      inverted,
      ...(conditions !== null && { conditions }),
      ...(fields.length > 0 && { fields }),
    }))
    let ability: AppAbility
    try {
      ability = createPrismaAbility<AppAbility>(rules as never)
    } catch {
      throw new AccessUnavailableError('invalidPolicy')
    }
    const access: TeamAccessDecision = {
      actorId: this.principal.sub,
      type: 'jwt',
      organizationId: this.principal.organizationId,
      aclVersion: this.principal.aclVersion,
      ownerTrusted: team,
      credentialTrusted: team,
    }
    return { owner, team, ability, access }
  }

  /** Exact current-row decisions for a rule set. Memoized by the sorted ids. */
  facts(ruleIds: readonly string[]): Facts {
    const key = [...ruleIds].sort().join('|')
    const cached = this.cache.get(key)
    if (cached) return cached
    this.budget?.spend(ruleIds.length + this.exactSpecs.length, 'relevance')
    const { team, ability, access } = this.context(ruleIds)
    const record = this.registry.record(ability, access, this.organization) as unknown as Record<
      string,
      { allowed: boolean; fields: Record<string, boolean> }
    >
    const facts: Facts = {}
    for (const spec of this.exactSpecs) {
      const entry = record[spec.capability.id]
      facts[spec.key] =
        spec.capability.id === 'teamAccess.manage'
          ? team
          : spec.field
            ? (entry?.fields[spec.field] ?? false)
            : (entry?.allowed ?? false)
    }
    this.cache.set(key, facts)
    return facts
  }

  /** The operation-level hint the registry already publishes; display only. */
  hints(ruleIds: readonly string[]): Record<string, 'allowed' | 'recordRequired' | 'denied'> {
    const { ability, access } = this.context(ruleIds)
    return this.registry.actor(ability, access) as Record<
      string,
      'allowed' | 'recordRequired' | 'denied'
    >
  }

  /** Rules after validation, interpolation and ordering, for source attribution. */
  normalized(ruleIds: readonly string[]): AbilityPermission[] {
    return this.normalize(ruleIds)
  }
}

/**
 * Capabilities the registry answers exactly for the current organization row. It is read from
 * `record()` itself, so a capability becomes exact only when a developer extends it deliberately.
 */
export function exactCapabilityIds(
  registry: CapabilityRegistry,
  organization: Organization
): Set<string> {
  const access: TeamAccessDecision = {
    actorId: 'probe',
    type: 'jwt',
    organizationId: organization.id,
    aclVersion: organization.aclVersion,
    ownerTrusted: false,
    credentialTrusted: false,
  }
  const probe = createPrismaAbility<AppAbility>([] as never)
  return new Set([
    'teamAccess.manage',
    ...Object.keys(registry.record(probe, access, organization)),
  ])
}
