import { CAPABILITY_CATALOGUE, type CapabilityId, type RequestPrincipal } from '@amcore/shared'

import type { AppAbility, TeamAccessDecision } from '../../auth/casl/ability.factory'
import {
  type AbilityPermission,
  hasFullTeamAccess,
  normalizeOwnerPermissions,
} from '../../auth/casl/permission-normalization'
import { createPrismaAbility } from '../../auth/casl/prisma-ability'
import type { CapabilityRegistry } from '../capability-registry.service'

import type { Organization } from '@/generated/prisma/client'

/** A stored rule as loaded; conditions stay the uninterpolated template. */
export type StoredPolicyRule = AbilityPermission

/** One thing a member may or may not do, as the explanation reports it. */
export interface ItemSpec {
  key: string
  capabilityId: CapabilityId
  /** Set for a per-field item of an editable capability. */
  field?: string
  /** Independent of any role: the registry hard-codes bearer membership for it. */
  baseline: boolean
}

/** Capabilities whose bearer-membership decision does not depend on roles (registry `actor`/`record`). */
const BASELINE_CAPABILITIES = new Set<string>(['organization.read'])

export function itemSpecs(): ItemSpec[] {
  return CAPABILITY_CATALOGUE.flatMap((entry) => {
    const id = entry.id
    return [
      { key: id, capabilityId: id, baseline: BASELINE_CAPABILITIES.has(id) },
      ...entry.editableFields.map((field) => ({
        key: `${id}.${field}`,
        capabilityId: id,
        field,
        baseline: false,
      })),
    ]
  })
}

export type Facts = Record<string, boolean>

/**
 * Evaluates the real policy for the member: the same normalization, ability and registry the API
 * uses to authorize, so an explanation can never describe a rule set the server would not apply.
 * Throws when a stored rule is invalid; the caller turns that into `ROLE_ACCESS_UNAVAILABLE`.
 */
export class AccessPolicy {
  private readonly cache = new Map<string, Facts>()

  constructor(
    private readonly rules: ReadonlyMap<string, StoredPolicyRule>,
    private readonly principal: RequestPrincipal,
    private readonly organization: Organization,
    private readonly registry: CapabilityRegistry
  ) {}

  private normalize(ruleIds: readonly string[]): AbilityPermission[] {
    const raw = ruleIds.map((id) => this.rules.get(id)!).filter(Boolean)
    return normalizeOwnerPermissions(raw, this.principal)
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
    const ability = createPrismaAbility<AppAbility>(rules as never)
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
    const { team, ability, access } = this.context(ruleIds)
    const record = this.registry.record(ability, access, this.organization) as unknown as Record<
      string,
      { allowed: boolean; fields: Record<string, boolean> }
    >
    const facts: Facts = {}
    for (const spec of itemSpecs()) {
      const entry = record[spec.capabilityId]
      facts[spec.key] =
        spec.capabilityId === 'teamAccess.manage'
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
