import { Action, type CapabilityId, type RoleDefinitionPreset, Subject } from '@amcore/shared'

import { CAPABILITY_ADAPTERS } from './capability-registry.service'

/** A stored rule as the classifier sees it; conditions stay the uninterpolated template. */
export interface StoredRule {
  id: string
  action: string
  subject: string
  conditions: unknown
  fields: readonly string[]
  inverted: boolean
}

export type RuleClass = ({ kind: 'preset' } & RoleDefinitionPreset) | { kind: 'advanced' }

/** Key-order independent JSON text; template placeholders such as `${user.sub}` stay verbatim. */
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

/**
 * Exact shape of a rule: action, subject, inverted, the uninterpolated condition template and the
 * field set. Fields compare as an order-insensitive multiset, so `[]` (all fields) never equals a
 * restricted list and a duplicated field never matches a preset that lists it once.
 */
function signature(
  rule: Pick<StoredRule, 'action' | 'subject' | 'inverted' | 'conditions' | 'fields'>
): string {
  return canonicalJson([
    rule.action,
    rule.subject,
    rule.inverted,
    rule.conditions ?? null,
    [...rule.fields].sort(),
  ])
}

export { signature as ruleSignature }

let candidates: Map<string, RoleDefinitionPreset[]> | undefined

/** Signatures of every catalogue preset; a signature shared by two presets is ambiguous. */
function presetCandidates(): Map<string, RoleDefinitionPreset[]> {
  if (candidates) return candidates
  const map = new Map<string, RoleDefinitionPreset[]>()
  for (const [capabilityId, adapter] of Object.entries(CAPABILITY_ADAPTERS)) {
    for (const presetId of adapter.presets) {
      const built = adapter.preset(presetId)
      const key = signature({
        action: built.action,
        subject: built.subject,
        inverted: built.inverted ?? false,
        conditions: built.conditions,
        fields: built.fields ?? [],
      })
      const list = map.get(key) ?? []
      list.push({
        capabilityId: capabilityId as CapabilityId,
        presetId: presetId as RoleDefinitionPreset['presetId'],
      })
      map.set(key, list)
    }
  }
  candidates = map
  return map
}

/**
 * Backend-owned recognition of an editor-managed rule. Anything unrecognized or ambiguous is
 * `advanced`: it is shown read-only and never rewritten or removed by the editor.
 */
export function classifyStoredRule(rule: StoredRule): RuleClass {
  const matches = presetCandidates().get(signature(rule))
  const only = matches?.length === 1 ? matches[0] : undefined
  return only ? { kind: 'preset', ...only } : { kind: 'advanced' }
}

export const presetKey = (preset: RoleDefinitionPreset): string =>
  `${preset.capabilityId}:${preset.presetId}`

/** Configured (not effective) full team administration: a non-inverted `manage:TeamAccess` rule. */
export const isFullControlRule = (
  rule: Pick<StoredRule, 'action' | 'subject' | 'inverted'>
): boolean => !rule.inverted && rule.action === Action.Manage && rule.subject === Subject.TeamAccess
