import type { Capability } from '@/entities/organization-context'
import { capabilityAreaViews } from '@/entities/organization-context'

import { presetKey } from './role-draft'

export { isAreaOpen, isLarge, LARGE_CATALOGUE, matchesQuery } from '@/entities/organization-context'
export const isConfigured = (capability: Capability, keys: readonly string[]) =>
  capability.presets.some((preset) => keys.includes(presetKey(capability.id, preset)))
export const areaViews = (
  capabilities: readonly Capability[],
  keys: readonly string[],
  filter: { query: string; onlyConfigured: boolean },
  textsOf: Parameters<typeof capabilityAreaViews>[3]
) =>
  capabilityAreaViews(capabilities, (capability) => isConfigured(capability, keys), filter, textsOf)
