import type {
  CapabilityCatalogueResponse,
  RoleDefinitionDetail,
  SaveRoleDefinition,
} from '@amcore/shared'

type Capability = CapabilityCatalogueResponse['capabilities'][number]

/** Everything the editor lets a person change, based on one server revision. */
export interface RoleDraft {
  revision: number
  name: string
  description: string
  /** Complete managed-preset selection as `capabilityId:presetId` keys. */
  keys: readonly string[]
}

export const presetKey = (capabilityId: string, presetId: string) => `${capabilityId}:${presetId}`

export function baselineDraft(detail: RoleDefinitionDetail): RoleDraft {
  return {
    revision: detail.aclVersion,
    name: detail.role.name,
    description: detail.role.description ?? '',
    keys: (detail.managedPresets ?? []).map((p) => presetKey(p.capabilityId, p.presetId)),
  }
}

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

export function isDirty(draft: RoleDraft, base: RoleDraft) {
  return (
    draft.name !== base.name ||
    draft.description !== base.description ||
    !sameKeys(draft.keys, base.keys)
  )
}

export function togglePreset(draft: RoleDraft, capabilityId: string, presetId: string): RoleDraft {
  const key = presetKey(capabilityId, presetId)
  const keys = draft.keys.includes(key) ? draft.keys.filter((k) => k !== key) : [...draft.keys, key]
  return { ...draft, keys }
}

/** Confirmations the save needs; they mirror the server's acknowledgment rules. */
export function requiredAcknowledgments(
  draft: RoleDraft,
  base: RoleDraft,
  selfHeld: boolean,
  catalogue: readonly Capability[]
) {
  const risky = new Set(catalogue.filter((c) => c.risk === 'fullControl').map((c) => c.id))
  const grants = (keys: readonly string[]) => keys.some((k) => risky.has(k.split(':')[0] as never))
  return {
    fullControl: grants(draft.keys) && !grants(base.keys),
    selfHeld: selfHeld && !sameKeys(draft.keys, base.keys),
  }
}

/** The complete definition to save; untouched text is sent exactly as stored. */
export function toSaveRequest(
  draft: RoleDraft,
  detail: RoleDefinitionDetail,
  acks: { fullControl: boolean; selfHeld: boolean }
): SaveRoleDefinition {
  const stored = detail.role.description
  const untouched = draft.description === (stored ?? '')
  return {
    expectedAclVersion: draft.revision,
    name: draft.name,
    description: untouched ? stored : draft.description.trim() || null,
    presets: draft.keys.map((key) => {
      const [capabilityId, presetId] = key.split(':')
      return { capabilityId, presetId } as SaveRoleDefinition['presets'][number]
    }),
    ...(acks.fullControl ? { acknowledgeFullControl: true as const } : {}),
    ...(acks.selfHeld ? { acknowledgeSelfHeld: true as const } : {}),
  }
}
