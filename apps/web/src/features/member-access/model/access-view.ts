import type { MemberAccess } from '@amcore/shared'

type Item = MemberAccess['items'][number]
type RoleRefs = NonNullable<Item['reachedBy']>

/** How a row reads at a glance. */
export type Tone = 'included' | 'allowed' | 'blocked' | 'denied'

export const toneOf = (item: Item): Tone =>
  item.baseline
    ? 'included'
    : item.granted
      ? 'allowed'
      : item.reason === 'vetoed'
        ? 'blocked'
        : 'denied'

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
  refs: RoleRefs | null,
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
 * What a reader needs first: everything the person can do or is blocked from, and, apart, what no
 * role gives them. A per-field line is dropped when the whole operation and that field are both allowed (it would
 * only repeat it); a field that is blocked while the rest is allowed always stays, and per-field lines of an operation that is not allowed stay out of the "not allowed"
 * group, so the list does not grow with every field a downstream capability declares.
 */
export function splitItems(
  items: readonly Item[],
  ids: readonly string[]
): { active: Item[]; inactive: Item[] } {
  const parts = new Map(items.map((item) => [item.key, capabilityOf(item.key, ids)]))
  const allowedWhole = new Set(
    items.filter((item) => item.granted && !parts.get(item.key)?.field).map((item) => item.key)
  )
  const active: Item[] = []
  const inactive: Item[] = []
  for (const item of items) {
    const part = parts.get(item.key)
    if (part?.field && item.granted && allowedWhole.has(part.id)) continue
    if (item.baseline || item.granted || item.reason === 'vetoed') active.push(item)
    else if (!part?.field) inactive.push(item)
  }
  return { active, inactive }
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
    const key = [source.effect, source.status, source.via, source.field ?? ''].join('|')
    const found = merged.get(key)
    if (found) found.roleIds = [...new Set([...found.roleIds, ...source.roleIds])]
    else merged.set(key, { ...source, roleIds: [...source.roleIds] })
  }
  return [...merged.values()]
}
