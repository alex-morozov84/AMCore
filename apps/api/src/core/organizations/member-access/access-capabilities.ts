import {
  ACCESS_FIELDS_MAX,
  ACCESS_MAX_ITEMS,
  CAPABILITY_CATALOGUE,
  type CapabilityId,
} from '@amcore/shared'

import { CAPABILITY_ADAPTERS, type CapabilityAdapter } from '../capability-registry.service'

import { AccessUnavailableError } from './access-budget'

/**
 * What the explanation needs to know about one registered capability. It is read from the adapter a
 * developer already writes to register an operation; nothing else has to be provided.
 */
/** The rule a preset stores; a downstream subject need not be one the starter knows. */
export interface PresetTemplate {
  action: string
  subject: string
  conditions?: unknown
  fields?: readonly string[]
  inverted?: boolean
}

export interface AccessCapability {
  id: string
  subject: string
  action: string
  editableFields: readonly string[]
  presets: readonly string[]
  requiredReadFields: readonly string[]
  teamAccess: boolean
  access?: 'none'
  preset: (presetId: string) => PresetTemplate
}

export function defaultCapabilities(): AccessCapability[] {
  return CAPABILITY_CATALOGUE.map((entry) => {
    const adapter: CapabilityAdapter = CAPABILITY_ADAPTERS[entry.id as CapabilityId]
    return {
      id: entry.id,
      subject: adapter.subject,
      action: adapter.action,
      editableFields: adapter.editableFields,
      presets: adapter.presets,
      requiredReadFields: adapter.requiredReadFields,
      teamAccess: adapter.teamAccess,
      ...(adapter.access && { access: adapter.access }),
      preset: adapter.preset,
    }
  })
}

/** One thing a member may or may not do, as the explanation reports it. */
export interface ItemSpec {
  key: string
  capability: AccessCapability
  /** Set for a per-field item of an editable capability. */
  field?: string
  /** Independent of any role: the registry hard-codes bearer membership for it. */
  baseline: boolean
  mode: 'record' | 'configured' | 'notEvaluated'
}

/** Capabilities whose bearer-membership decision does not depend on roles (registry `actor`/`record`). */
const BASELINE_CAPABILITIES = new Set<string>(['organization.read'])

export function itemSpecs(
  capabilities: readonly AccessCapability[],
  exact: ReadonlySet<string>
): ItemSpec[] {
  return capabilities.flatMap((capability): ItemSpec[] => {
    if (capability.access === 'none')
      return [{ key: capability.id, capability, baseline: false, mode: 'notEvaluated' }]
    const mode: ItemSpec['mode'] = exact.has(capability.id) ? 'record' : 'configured'
    return [
      {
        key: capability.id,
        capability,
        baseline: BASELINE_CAPABILITIES.has(capability.id),
        mode,
      },
      ...capability.editableFields.map((field) => ({
        key: `${capability.id}.${field}`,
        capability,
        field,
        baseline: false,
        mode,
      })),
    ]
  })
}

/**
 * The most items one explanation may name, known from the catalogue alone so that an oversized
 * catalogue is refused before anything is loaded.
 */
export function countItemSpecs(capabilities: readonly AccessCapability[]): number {
  return capabilities.reduce(
    (total, capability) =>
      total + (capability.access === 'none' ? 1 : 1 + capability.editableFields.length),
    0
  )
}

export function assertCatalogueWithinLimits(capabilities: readonly AccessCapability[]): void {
  if (
    countItemSpecs(capabilities) > ACCESS_MAX_ITEMS ||
    capabilities.some((capability) => capability.editableFields.length > ACCESS_FIELDS_MAX)
  )
    throw new AccessUnavailableError('catalogueTooLarge')
}
