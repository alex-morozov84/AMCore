import type { UserResponse } from '@amcore/shared'
import type { QueryClient } from '@tanstack/react-query'

export type QueryOwner = { userId: string; contextSession: string }
export type UserEnvelope = { user: UserResponse | null; contextSession?: string }
export const currentUserKey = ['user', 'me'] as const

export function queryOwner(envelope?: UserEnvelope): QueryOwner | null {
  return envelope?.user && envelope.contextSession
    ? { userId: envelope.user.id, contextSession: envelope.contextSession }
    : null
}

export function sameQueryOwner(a: QueryOwner | null, b: QueryOwner | null): boolean {
  return !!a && !!b && a.userId === b.userId && a.contextSession === b.contextSession
}

export const personalKey = (owner: QueryOwner | null) =>
  ['personal', owner?.contextSession ?? null, owner?.userId ?? null] as const

export function captureQuerySession(client: QueryClient) {
  return {
    owner: queryOwner(client.getQueryData<UserEnvelope>(currentUserKey)),
    query: client.getQueryCache().find({ queryKey: currentUserKey, exact: true }),
  }
}

export function isCurrentQuerySession(
  client: QueryClient,
  captured: ReturnType<typeof captureQuerySession> | undefined
): boolean {
  const current = captureQuerySession(client)
  return (
    !!captured?.query &&
    captured.query === current.query &&
    sameQueryOwner(captured.owner, current.owner)
  )
}

/** Retire only owned collections. A cancelled bootstrap read must have no side effects. */
export async function retirePersonalQueries(
  client: QueryClient,
  owner: QueryOwner | null,
  current: () => boolean
): Promise<boolean> {
  if (!current()) return false
  const filter = {
    queryKey: ['personal'],
    predicate: (query: { queryKey: readonly unknown[] }) =>
      !owner || query.queryKey[1] !== owner.contextSession || query.queryKey[2] !== owner.userId,
  }
  await client.cancelQueries(filter)
  if (!current()) return false
  client.removeQueries(filter)
  return true
}

/** Keep the subscribed bootstrap Query; its notification switches dependent owned keys. */
export async function publishCurrentUser(
  client: QueryClient,
  envelope: UserEnvelope,
  current: () => boolean = () => true
): Promise<boolean> {
  if (!current()) return false
  await client.cancelQueries({ queryKey: currentUserKey, exact: true })
  if (!(await retirePersonalQueries(client, queryOwner(envelope), current)) || !current())
    return false
  client.setQueryData(currentUserKey, envelope)
  return true
}
