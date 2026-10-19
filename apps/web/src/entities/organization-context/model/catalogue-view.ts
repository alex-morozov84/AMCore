import type { CapabilityCatalogueResponse } from '@amcore/shared'

export type Capability = Omit<
  CapabilityCatalogueResponse['capabilities'][number],
  'id' | 'presets'
> & { id: string; presets: readonly string[] }

/**
 * Above this many capabilities the editor offers search, collapsible areas and "only configured".
 * With fewer the accepted flat layout is kept: nothing to find, nothing to hide.
 */
export const LARGE_CATALOGUE = 12

export const isLarge = (capabilities: readonly Capability[]): boolean =>
  capabilities.length > LARGE_CATALOGUE

export interface CapabilityTexts {
  label?: string
  description?: string
  area: string
}

/** A capability matches when every word of the query is found in its label, description, id or area. */
export function matchesQuery(
  capability: Capability,
  query: string,
  texts: CapabilityTexts
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [texts.label, texts.description, capability.id, texts.area, capability.subject]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export function groupByArea(
  capabilities: readonly Capability[]
): [area: string, items: Capability[]][] {
  const groups = new Map<string, Capability[]>()
  for (const capability of capabilities)
    groups.set(capability.subject, [...(groups.get(capability.subject) ?? []), capability])
  return [...groups]
}

export interface AreaView {
  area: string
  /** The capabilities of the area that pass the filters. */
  items: Capability[]
  total: number
  configured: number
}

/** Areas with their visible capabilities; an area with nothing to show is left out. */
export function areaViews(
  capabilities: readonly Capability[],
  configured: (capability: Capability) => boolean,
  filter: { query: string; onlyConfigured: boolean },
  textsOf: (capability: Capability) => CapabilityTexts
): AreaView[] {
  return groupByArea(capabilities).flatMap(([area, all]) => {
    const items = all.filter(
      (capability) =>
        (!filter.onlyConfigured || configured(capability)) &&
        matchesQuery(capability, filter.query, textsOf(capability))
    )
    return items.length === 0
      ? []
      : [
          {
            area,
            items,
            total: all.length,
            configured: all.filter((capability) => configured(capability)).length,
          },
        ]
  })
}

/** An area opens by default when something in it is configured; a searched list opens every match. */
export const isAreaOpen = (
  view: AreaView,
  state: Readonly<Record<string, boolean>>,
  searching: boolean
): boolean => searching || (state[view.area] ?? view.configured > 0)
