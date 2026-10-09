import {
  ACCESS_CONFIGURED_SOURCES_PER_ITEM,
  type AccessArea,
  type AccessConfiguredItem,
  type AccessLimit,
  configuredInvariants,
} from '@amcore/shared'

import type { AbilityPermission } from '../../auth/casl/permission-normalization'
import { ruleSignature } from '../role-definition-classifier'

import { type AccessOperationBudget, AccessUnavailableError } from './access-budget'
import type { AccessCapability, ItemSpec } from './access-capabilities'
import type { StoredPolicyRule } from './access-facts'
import { aggregatePrerequisite, type Prerequisite, prerequisiteCheck } from './access-prerequisites'
import {
  conditionKeys,
  coversAnyField,
  coversField,
  isRelevant,
  isUnconditional,
} from './access-rule-utils'
import { roleRefs } from './access-sources'

type Kind = AccessArea['kind']
type RuleSource = Extract<AccessConfiguredItem['sources'][number], { kind: 'rule' }>
type Refs = { roleIds: string[]; total: number }

const KIND_ORDER: readonly Kind[] = ['all', 'assigned', 'own', 'custom']
const STATUS_ORDER = { vetoes: 0, restricts: 1, contributes: 2, overridden: 3 } as const

export interface ConfiguredContext {
  /** The whole policy after validation, interpolation and ordering. */
  policy: readonly AbilityPermission[]
  rolesByRule: ReadonlyMap<string, readonly string[]>
  /** Rules as stored (uninterpolated), for preset recognition. */
  stored: ReadonlyMap<string, StoredPolicyRule>
  budget: AccessOperationBudget
}

/** Preset signatures of one capability; a signature two presets share is ambiguous and ignored. */
function presetKinds(capability: AccessCapability): Map<string, { kind: Kind; presetId: string }> {
  const seen = new Map<string, { kind: Kind; presetId: string } | null>()
  for (const presetId of capability.presets) {
    const built = capability.preset(presetId)
    const signature = ruleSignature({
      action: built.action,
      subject: built.subject,
      inverted: built.inverted ?? false,
      conditions: built.conditions,
      fields: built.fields ?? [],
    })
    const kind = (['all', 'assigned', 'own'] as const).find((entry) => entry === presetId)
    seen.set(signature, seen.has(signature) || !kind ? null : { kind, presetId })
  }
  return new Map(
    [...seen].filter(
      (entry): entry is [string, { kind: Kind; presetId: string }] => entry[1] !== null
    )
  )
}

/**
 * What the role settings configure for a capability the registry has no exact answer for. It
 * answers by independent areas and never claims the right holds for a particular record. Every
 * calculation uses all rules; only afterwards are the displayed sources limited.
 */
export function evaluateConfigured(spec: ItemSpec, ctx: ConfiguredContext): AccessConfiguredItem {
  const { capability, field } = spec
  const { policy, budget } = ctx
  const key = conditionKeys(budget)
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
  const allows = relevant.filter((rule) => !rule.inverted)
  const denies = relevant.filter((rule) => rule.inverted)
  const item = (over: Partial<AccessConfiguredItem>): AccessConfiguredItem =>
    check({
      key: spec.key,
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
  if (allows.length === 0) return item({})

  const kinds = presetKinds(capability)
  const classify = (rule: AbilityPermission): { kind: Kind; presetId: string | null } => {
    const stored = ctx.stored.get(rule.id)
    const preset = stored ? kinds.get(ruleSignature(stored)) : undefined
    if (preset) return preset
    return { kind: isUnconditional(rule) ? 'all' : 'custom', presetId: null }
  }
  const prerequisite = prerequisiteCheck(capability, policy, key, budget)

  const coveredBy = (rule: AbilityPermission): readonly string[] | null =>
    itemFields === null
      ? coversAnyField(rule)
        ? null
        : rule.fields
      : itemFields.filter((name) => coversField(rule, name))

  // Masking: a deny hides an allow it covers when it is unconditional or has the identical condition.
  budget.spend(allows.length + denies.length, 'mask')
  const unconditionalDenies = denies.filter(isUnconditional)
  const deniesByKey = new Map<string, AbilityPermission[]>()
  for (const deny of denies.filter((rule) => !isUnconditional(rule)))
    deniesByKey.set(key(deny), [...(deniesByKey.get(key(deny)) ?? []), deny])
  const maskers = new Set<string>()
  const masked = new Set<string>()
  const denyCoversRule = (deny: AbilityPermission, rule: AbilityPermission): boolean => {
    const covered = coveredBy(rule)
    return covered === null
      ? coversAnyField(deny)
      : covered.every((name) => coversField(deny, name))
  }
  for (const rule of allows)
    for (const deny of [...unconditionalDenies, ...(deniesByKey.get(key(rule)) ?? [])])
      if (denyCoversRule(deny, rule)) {
        masked.add(rule.id)
        maskers.add(deny.id)
      }
  const globalBlock = covers2(unconditionalDenies, itemFields)
  const unmaskedRules = allows.filter((rule) => !masked.has(rule.id))

  // Areas, one per kind; the prerequisite is aggregated from the unmasked rules of the area.
  const kindOf = new Map(allows.map((rule) => [rule.id, classify(rule)]))
  const prereqOf = new Map(allows.map((rule) => [rule.id, prerequisite.of(rule)]))
  budget.spend(allows.length, 'aggregate')
  const areas: AccessArea[] = KIND_ORDER.flatMap((kind) => {
    const all = allows.filter((rule) => kindOf.get(rule.id)?.kind === kind)
    if (all.length === 0) return []
    const live = all.filter((rule) => !masked.has(rule.id))
    const used = live.length > 0 ? live : all
    return [
      {
        kind,
        roles: roleRefs(used.flatMap((rule) => ctx.rolesByRule.get(rule.id) ?? [])),
        fields: areaFields(used, itemFields),
        prerequisite: aggregatePrerequisite(
          used.map((rule) => prereqOf.get(rule.id) as Prerequisite)
        ),
        masked: live.length === 0,
        absorbed: false,
      },
    ]
  })
  const unmasked = areas.filter((area) => !area.masked)

  // Limits come from distinct causes; conditions are never solved, only compared textually.
  const partial = unconditionalDenies.filter((deny) => !denyCovers(deny, itemFields))
  const partialFields = [
    ...new Set(
      partial.flatMap((deny) =>
        itemFields === null ? deny.fields : itemFields.filter((name) => coversField(deny, name))
      )
    ),
  ]
  const conditionalDenies = [...deniesByKey.values()].flat()
  const denyLimits: AccessLimit[] = [
    ...(conditionalDenies.length > 0 && unmaskedRules.length > 0
      ? [{ kind: 'denyCondition' as const }]
      : []),
    ...(partialFields.length > 0 && unmaskedRules.length > 0
      ? [{ kind: 'denyFields' as const, fields: partialFields }]
      : []),
  ]
  const own = unmasked.flatMap((area): AccessLimit[] => [
    ...(area.kind === 'custom' ? [{ kind: 'condition' as const }] : []),
  ])
  const limitedFields = [...new Set(unmasked.flatMap((area) => area.fields ?? []))]
  const fieldLimits: AccessLimit[] =
    unmasked.some((area) => area.fields !== null) && limitedFields.length > 0
      ? [{ kind: 'fields', fields: limitedFields }]
      : []

  const blockedByPrerequisite =
    unmasked.length > 0 && unmasked.every((area) => area.prerequisite === 'blocked')
  const blocked = globalBlock || areas.every((area) => area.masked) || blockedByPrerequisite
  const sources = sourcesOf()
  const shown = sources.slice(0, ACCESS_CONFIGURED_SOURCES_PER_ITEM)
  const base = { sources: shown, sourcesTruncated: sources.length > shown.length }

  if (blocked) {
    const blockers = globalBlock
      ? unconditionalDenies
      : blockedByPrerequisite
        ? prerequisite.blockers
        : denies.filter((deny) => maskers.has(deny.id))
    return item({
      ...base,
      state: 'blocked',
      areas,
      limits: dedupe([...own, ...fieldLimits, ...denyLimits]),
      blockedBy: roleRefs(blockers.flatMap((rule) => ctx.rolesByRule.get(rule.id) ?? [])),
    })
  }
  if (unmasked.every((area) => area.prerequisite === 'missing'))
    return item({
      ...base,
      state: 'missingPrerequisite',
      areas,
      limits: dedupe([...own, ...fieldLimits, ...denyLimits]),
    })
  const open = unmasked.find(
    (area) =>
      area.kind === 'all' &&
      area.fields === null &&
      (area.prerequisite === 'met' || area.prerequisite === 'notRequired')
  )
  if (open && denyLimits.length === 0 && !areas.some((area) => area.masked))
    return item({
      ...base,
      state: 'allowed',
      areas: areas.map((area) => (area === open ? area : { ...area, absorbed: true })),
    })
  return item({
    ...base,
    state: 'configured',
    areas,
    limits: dedupe([...own, ...fieldLimits, ...denyLimits]),
  })

  function sourcesOf(): RuleSource[] {
    const status = (rule: AbilityPermission): RuleSource['status'] =>
      rule.inverted
        ? (isUnconditional(rule) && denyCovers(rule, itemFields)) || maskers.has(rule.id)
          ? 'vetoes'
          : 'restricts'
        : masked.has(rule.id)
          ? 'overridden'
          : 'contributes'
    const build = (rule: AbilityPermission, via: RuleSource['via']): RuleSource => {
      const detail = rule.inverted ? undefined : kindOf.get(rule.id)
      return {
        kind: 'rule',
        via,
        ...(field !== undefined && via === 'direct' && { field }),
        roleIds: roleRefs(ctx.rolesByRule.get(rule.id) ?? []).roleIds,
        permissionId: rule.id,
        presetId: detail?.presetId ?? null,
        effect: rule.inverted ? 'deny' : 'allow',
        status: via === 'direct' ? status(rule) : 'vetoes',
        area: detail?.kind ?? null,
        prerequisite: rule.inverted ? null : (prereqOf.get(rule.id) ?? null),
      }
    }
    const all = [
      ...relevant.map((rule) => build(rule, 'direct')),
      ...prerequisite.readDenies.map((rule) => build(rule, 'readPrerequisite')),
      ...prerequisite.teamVeto.map((rule) => build(rule, 'teamAccessVeto')),
    ]
    return all.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        KIND_ORDER.indexOf(a.area ?? 'custom') - KIND_ORDER.indexOf(b.area ?? 'custom') ||
        (a.permissionId < b.permissionId ? -1 : a.permissionId > b.permissionId ? 1 : 0)
    )
  }
}

const dedupe = (limits: AccessLimit[]): AccessLimit[] => [
  ...new Map(limits.map((limit) => [limit.kind, limit])).values(),
]

/** The fields an unconditional deny covers of the item: everything or every wanted field. */
function denyCovers(deny: AbilityPermission, wanted: readonly string[] | null): boolean {
  return wanted === null ? coversAnyField(deny) : wanted.every((name) => coversField(deny, name))
}

/** Whether the union of the denies covers every wanted field. */
function covers2(denies: readonly AbilityPermission[], wanted: readonly string[] | null): boolean {
  if (wanted === null) return denies.some(coversAnyField)
  return wanted.every((name) => denies.some((deny) => coversField(deny, name)))
}

/** `null` = every field of the item; otherwise the union of what the rules of the area cover. */
function areaFields(
  rules: readonly AbilityPermission[],
  wanted: readonly string[] | null
): string[] | null {
  if (wanted === null)
    return rules.some(coversAnyField) ? null : [...new Set(rules.flatMap((r) => r.fields))]
  const union = wanted.filter((name) => rules.some((rule) => coversField(rule, name)))
  return union.length === wanted.length ? null : union
}

/** An item that breaks its own state matrix is never served. */
function check(item: AccessConfiguredItem): AccessConfiguredItem {
  if (configuredInvariants(item)) throw new AccessUnavailableError('unexpected')
  return item
}

export type { Refs }
