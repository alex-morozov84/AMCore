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
