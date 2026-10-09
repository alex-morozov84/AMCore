import type { AccessArea, AccessLimit } from '@amcore/shared'

import type { AbilityPermission } from '../../auth/casl/permission-normalization'
import { ruleSignature } from '../role-definition-classifier'

import type { AccessCapability } from './access-capabilities'
import type { StoredPolicyRule } from './access-facts'
import { aggregatePrerequisite, type Prerequisite } from './access-prerequisites'
import { coversAnyField, coversField, isUnconditional } from './access-rule-utils'
import { roleRefs } from './access-sources'
import { denyCovers, type Masking, type Scan } from './configured-scan'

export type Kind = AccessArea['kind']
export const KIND_ORDER: readonly Kind[] = ['all', 'assigned', 'own', 'custom']

export interface Classified {
  kind: Kind
  presetId: string | null
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
 * The area of an allow rule: the preset of this capability when the S1 classifier recognises it,
 * otherwise `all` for an unconditional rule and `custom` for any other condition.
 */
export function classifier(
  capability: AccessCapability,
  stored: ReadonlyMap<string, StoredPolicyRule>
): (rule: AbilityPermission) => Classified {
  const kinds = presetKinds(capability)
  return (rule) => {
    const original = stored.get(rule.id)
    const preset = original ? kinds.get(ruleSignature(original)) : undefined
    return preset ?? { kind: isUnconditional(rule) ? 'all' : 'custom', presetId: null }
  }
}

/** `null` = every field of the item; otherwise the union of what the rules of the area cover. */
function areaFields(
  rules: readonly AbilityPermission[],
  wanted: Scan['itemFields']
): string[] | null {
  if (wanted === null)
    return rules.some(coversAnyField) ? null : [...new Set(rules.flatMap((rule) => rule.fields))]
  const union = wanted.filter((name) => rules.some((rule) => coversField(rule, name)))
  return union.length === wanted.length ? null : union
}

/** One area per kind; its prerequisite is aggregated from the unmasked rules of the area. */
export function buildAreas(
  scan: Scan,
  masking: Masking,
  kindOf: ReadonlyMap<string, Classified>,
  prereqOf: ReadonlyMap<string, Prerequisite>,
  rolesByRule: ReadonlyMap<string, readonly string[]>
): AccessArea[] {
  return KIND_ORDER.flatMap((kind) => {
    const all = scan.allows.filter((rule) => kindOf.get(rule.id)?.kind === kind)
    if (all.length === 0) return []
    const live = all.filter((rule) => !masking.masked.has(rule.id))
    const used = live.length > 0 ? live : all
    return [
      {
        kind,
        roles: roleRefs(used.flatMap((rule) => rolesByRule.get(rule.id) ?? [])),
        fields: areaFields(used, scan.itemFields),
        prerequisite: aggregatePrerequisite(
          used.map((rule) => prereqOf.get(rule.id) as Prerequisite)
        ),
        masked: live.length === 0,
        absorbed: false,
      },
    ]
  })
}

/** The limits caused by denies that did not decide the item; conditions are only compared textually. */
export function denyLimits(scan: Scan, masking: Masking): AccessLimit[] {
  if (masking.unmaskedRules.length === 0) return []
  const partialFields = [
    ...new Set(
      masking.unconditionalDenies
        .filter((deny) => !denyCovers(deny, scan.itemFields))
        .flatMap((deny) =>
          scan.itemFields === null
            ? deny.fields
            : scan.itemFields.filter((name) => coversField(deny, name))
        )
    ),
  ]
  return [
    ...(masking.conditionalByKey.size > 0 ? [{ kind: 'denyCondition' as const }] : []),
    ...(partialFields.length > 0 ? [{ kind: 'denyFields' as const, fields: partialFields }] : []),
  ]
}

/** The limits the unmasked areas themselves carry: a custom condition, only some fields. */
export function areaLimits(unmasked: readonly AccessArea[]): AccessLimit[] {
  const limitedFields = [...new Set(unmasked.flatMap((area) => area.fields ?? []))]
  return [
    ...(unmasked.some((area) => area.kind === 'custom') ? [{ kind: 'condition' as const }] : []),
    ...(unmasked.some((area) => area.fields !== null) && limitedFields.length > 0
      ? [{ kind: 'fields' as const, fields: limitedFields }]
      : []),
  ]
}
