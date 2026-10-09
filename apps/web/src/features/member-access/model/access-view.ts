import type { AccessConfiguredItem, AccessRecordItem, MemberAccess } from '@amcore/shared'

type Item = MemberAccess['items'][number]

/** How a row reads at a glance. */
export type Tone =
  'included' | 'allowed' | 'configured' | 'blocked' | 'ineffective' | 'denied' | 'unknown'

const CONFIGURED_TONE: Record<AccessConfiguredItem['state'], Tone> = {
  allowed: 'allowed',
  configured: 'configured',
  blocked: 'blocked',
  missingPrerequisite: 'ineffective',
  none: 'denied',
}

export function toneOf(item: Item): Tone {
  if (item.evaluation === 'notEvaluated') return 'unknown'
  if (item.evaluation === 'configured') return CONFIGURED_TONE[item.state]
  if (item.baseline) return 'included'
  if (item.granted) return 'allowed'
  return item.reason === 'vetoed' ? 'blocked' : 'denied'
}

/**
 * Splits an item key into its capability and optional field. Capability ids contain dots
 * (`organization.update`), so the longest matching id wins: `organization.update.name` is the field
 * `name` of `organization.update`.
 */
export function capabilityOf(
  key: string,
  ids: readonly string[]
): { id: string; field?: string } | undefined {
  const id = [...ids]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => key === candidate || key.startsWith(`${candidate}.`))
  if (!id) return undefined
  return key === id ? { id } : { id, field: key.slice(id.length + 1) }
}

/** Names the roles the response knows; a role beyond the shown list stays unnamed. */
export function roleNamer(access: MemberAccess): (id: string) => string | undefined {
  const names = new Map(access.roles.items.map((role) => [role.id, role.name]))
  return (id) => names.get(id)
}

/** The visible names of a bounded role set, how many more exist, and whether any was unnamed. */
export function describeRoles(
  refs: { roleIds: readonly string[]; total: number } | null,
  nameOf: (id: string) => string | undefined,
  unknown: string
): { names: string[]; more: number } {
  if (!refs) return { names: [], more: 0 }
  return {
    names: refs.roleIds.map((id) => nameOf(id) ?? unknown),
    more: Math.max(0, refs.total - refs.roleIds.length),
  }
}

/** Notes that explain the shape of the whole answer, in the order a reader needs them. */
export function wideningNotes(access: MemberAccess): ('breadth' | 'synergy' | 'vetoed')[] {
  const { breadth, synergy, vetoed } = access.widening
  return [
    ...(breadth ? (['breadth'] as const) : []),
    ...(synergy ? (['synergy'] as const) : []),
    ...(vetoed ? (['vetoed'] as const) : []),
  ]
}

/**
 * What a reader needs first: everything the person can do, is configured for or is blocked from;
 * apart, what no role gives them; and, in their own group, what the product did not evaluate (never
 * "not allowed"). A per-field line of an exact item is dropped when the whole operation and that
 * field are both allowed (it would only repeat it); the server already omits redundant lines of
 * configured items. Per-field lines of an operation that is not allowed stay out of the "not
 * allowed" group, so the list does not grow with every field a downstream capability declares.
 */
export function splitItems(
  items: readonly Item[],
  ids: readonly string[]
): { active: Item[]; inactive: Item[]; notEvaluated: Item[] } {
  const parts = new Map(items.map((item) => [item.key, capabilityOf(item.key, ids)]))
  const allowedWhole = new Set(
    items
      .filter((item) => item.evaluation === 'record' && item.granted && !parts.get(item.key)?.field)
      .map((item) => item.key)
  )
  const active: Item[] = []
  const inactive: Item[] = []
  const notEvaluated: Item[] = []
  for (const item of items) {
    const part = parts.get(item.key)
    if (item.evaluation === 'notEvaluated') notEvaluated.push(item)
    else if (item.evaluation === 'configured') {
      if (item.state !== 'none') active.push(item)
      else if (!part?.field) inactive.push(item)
    } else if (part?.field && item.granted && allowedWhole.has(part.id)) continue
    else if (item.baseline || item.granted || item.reason === 'vetoed') active.push(item)
    else if (!part?.field) inactive.push(item)
  }
  return { active, inactive, notEvaluated }
}

/** Groups items by the area (subject) of their capability, keeping the catalogue order. */
export function groupByArea<T extends Item>(
  items: readonly T[],
  capabilities: readonly { id: string; subject: string }[]
): [string, T[]][] {
  const groups = new Map<string, T[]>()
  const ids = capabilities.map((capability) => capability.id)
  for (const item of items) {
    const id = capabilityOf(item.key, ids)?.id
    const area = capabilities.find((capability) => capability.id === id)?.subject ?? ''
    groups.set(area, [...(groups.get(area) ?? []), item])
  }
  return [...groups]
}

type Source = Item['sources'][number]
type RuleSource = Extract<Source, { kind: 'rule' }>

/**
 * Rules that say the same thing about the same step are shown once with all their roles, so three
 * roles that each give "reading the organization" read as one line, not three.
 */
export function mergeSources(sources: readonly Source[]): (RuleSource & { roleIds: string[] })[] {
  const merged = new Map<string, RuleSource & { roleIds: string[] }>()
  for (const source of sources) {
    if (source.kind !== 'rule') continue
    const key = [
      source.effect,
      source.status,
      source.via,
      source.field ?? '',
      source.area ?? '',
    ].join('|')
    const found = merged.get(key)
    if (found) found.roleIds = [...new Set([...found.roleIds, ...source.roleIds])]
    else merged.set(key, { ...source, roleIds: [...source.roleIds] })
  }
  return [...merged.values()]
}

export type Via = RuleSource['via']

/** One group of roles in the "why" of a row, with the step it concerns when that is not the item itself. */
export interface WhyLine {
  roleIds: string[]
  via?: Via
}

/**
 * The reasons for an exact decision in the words a reader needs: who allows it, who blocks it, and,
 * only when the decision fails for lack of a prerequisite, which prerequisites were looked at.
 * Prerequisites that are met (reading the organization, team control) are the same for nearly
 * everyone and explain nothing, so they are left out.
 */
export function explainWhy(item: AccessRecordItem): {
  allows: WhyLine[]
  blocks: WhyLine[]
  needs: WhyLine[]
} {
  const allows: WhyLine[] = []
  const blocks: WhyLine[] = []
  const needs: WhyLine[] = []
  for (const source of mergeSources(item.sources)) {
    const line = {
      roleIds: source.roleIds,
      ...(source.via === 'direct' ? {} : { via: source.via }),
    }
    if (source.status === 'vetoes') blocks.push(line)
    else if (source.via === 'direct') allows.push(line)
    else needs.push(line)
  }
  return { allows, blocks, needs: item.reason === 'missingPrerequisite' ? needs : [] }
}

/** What a configured row's rules say, per area and cause, ready to be worded. */
export type ConfiguredWhyKind = 'allows' | 'overridden' | 'blocks' | 'restricts'
export interface ConfiguredWhyLine extends WhyLine {
  kind: ConfiguredWhyKind
  area: 'all' | 'assigned' | 'own' | 'custom' | null
}

export function configuredWhy(item: AccessConfiguredItem): ConfiguredWhyLine[] {
  return mergeSources(item.sources).map((source) => {
    const kind: ConfiguredWhyKind =
      source.effect === 'deny'
        ? source.status === 'vetoes'
          ? 'blocks'
          : 'restricts'
        : source.status === 'overridden'
          ? 'overridden'
          : 'allows'
    return {
      kind,
      area: source.area ?? null,
      roleIds: source.roleIds,
      ...(source.via === 'direct' ? {} : { via: source.via }),
    }
  })
}

/** The counts a reader gets above the list: what is allowed, configured for some records, blocked. */
export function summaryCounts(active: readonly Item[]): {
  allowed: number
  configured: number
  blocked: number
} {
  const counts = { allowed: 0, configured: 0, blocked: 0 }
  for (const item of active) {
    const tone = toneOf(item)
    if (tone === 'allowed' && !item.baseline) counts.allowed += 1
    else if (tone === 'configured') counts.configured += 1
    else if (tone === 'blocked' || tone === 'ineffective') counts.blocked += 1
  }
  return counts
}
