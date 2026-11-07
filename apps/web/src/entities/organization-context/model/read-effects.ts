import type { QueryClient } from '@tanstack/react-query'

import { invitationsClient } from '../api/invitations-client'
import { membersClient } from '../api/members-client'
import { rolesClient } from '../api/roles-client'

import type { AuthorityRefreshResult, OrganizationAccessController } from './access-controller'
import { assertReadCooldown, organizationReadKey, organizationReadOptions } from './read-options'

import 'client-only'

/** These existing resource families share the same scoped key contract on server and browser. */
export const invitationEffects = ['organization-invitations', 'organization-role-definition']
export const memberRoleEffects = [
  'organization-members',
  'organization-role-definition',
  'organization-role-definitions',
  'organization-member-access',
]

function resourceOptions(namespace: string, identity: string) {
  const [binding, orgId, input] = JSON.parse(identity)
  const load = (signal: AbortSignal): Promise<unknown> => {
    switch (namespace) {
      case 'organization-invitations':
        return invitationsClient.list(binding, orgId, input, signal)
      case 'organization-members':
        return input.userId
          ? membersClient.roles(binding, orgId, input.userId, input, signal)
          : membersClient.list(binding, orgId, input, signal)
      case 'organization-role-definition':
        return rolesClient.detail(binding, orgId, input, signal)
      case 'organization-role-definitions':
        return rolesClient.list(binding, orgId, input, signal)
      case 'organization-member-access':
        return rolesClient.memberAccess(binding, orgId, input, signal)
      default:
        throw new Error('UNSUPPORTED_ORGANIZATION_RESOURCE')
    }
  }
  return organizationReadOptions(
    organizationReadKey(namespace, identity),
    load,
    namespace === 'organization-invitations' ? 10000 : 5000
  )
}

/** Cancel before invalidation: cancellation may restore the resource's previous cache state. */
export async function invalidateOrganizationEffects(
  client: QueryClient,
  access: OrganizationAccessController,
  namespaces?: readonly string[]
) {
  const prefix = JSON.stringify([access.binding, access.organizationId]).slice(0, -1) + ','
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const family = String(queryKey[0])
    const identity = family === 'member-api-keys' ? JSON.parse(String(queryKey[1]))[0] : queryKey[1]
    return (
      (namespaces
        ? namespaces.includes(family)
        : family.startsWith('organization-') || family === 'member-api-keys') &&
      String(identity).startsWith(prefix)
    )
  }
  await client.cancelQueries({ predicate })
  await client.invalidateQueries({ predicate, refetchType: 'none' })
  return predicate
}

/** Deliberate binding-scoped broad refresh for cross-resource revision/access effects.
 * The legacy name remains for compatibility; narrower migration is not required. */
export async function refreshLegacyOrganizationEffects(
  client: QueryClient,
  access: OrganizationAccessController,
  signal?: AbortSignal
) {
  const epoch = access.capture()
  await invalidateOrganizationEffects(client, access)
  if (!access.current(epoch)) return 'retired' as const
  try {
    return await access.refresh(signal)
  } catch (error) {
    if (access.current(epoch)) access.setAuthority(false)
    throw error
  }
}

export async function refreshOrganizationEffects(
  client: QueryClient,
  access: OrganizationAccessController,
  namespaces: readonly string[],
  signal?: AbortSignal,
  refreshAuthority?: () => Promise<AuthorityRefreshResult>
) {
  const epoch = access.capture()
  const predicate = await invalidateOrganizationEffects(client, access, namespaces)
  signal?.throwIfAborted()
  const status = access.current(epoch) ? await refreshAuthority?.() : ('retired' as const)
  signal?.throwIfAborted()
  if (!access.current(epoch)) return 'retired' as const
  if (status && status !== 'ready') return status
  if (!access.allowed()) return 'denied' as const
  await Promise.all(
    client
      .getQueryCache()
      .findAll({ predicate })
      .filter((q) => q.getObserversCount())
      .map(async (q) => {
        assertReadCooldown(client, q.queryKey)
        const options = resourceOptions(String(q.queryKey[0]), String(q.queryKey[1]))
        await client.fetchQuery(options)
        // A resumed observer may finish this read first; cancellation leaves it invalidated.
        if (q.state.isInvalidated) throw new Error('REFRESH_CANCELLED')
      })
  )
  signal?.throwIfAborted()
  return !access.current(epoch)
    ? ('retired' as const)
    : access.allowed()
      ? ('ready' as const)
      : ('denied' as const)
}
