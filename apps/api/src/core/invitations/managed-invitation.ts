import type { Prisma } from '../../generated/prisma/client.js'
import { provisioningError } from '../organizations/provisioning/provisioning-error.js'

export type ManagedInvitationOwner = {
  kind: 'initial' | 'additional'
  id: string
  organizationId: string
  state: string
  currentGeneration: number | null
  generation: number
}

/** The caller holds the parent organization; all supported pointer writers take it first. */
export async function managedInvitationOwners(
  tx: Prisma.TransactionClient,
  orgId: string,
  target: { id: string } | { email: string }
): Promise<ManagedInvitationOwner[]> {
  return tx.$queryRaw<ManagedInvitationOwner[]>`
    SELECT p.*, i.generation FROM (
      SELECT 'initial' AS kind, "operationId"::text AS id, "organizationId", state,
        "currentInviteId", "currentGeneration" FROM core.organization_provisionings
      UNION ALL
      SELECT 'additional' AS kind, id::text, "organizationId", state,
        "currentInviteId", "currentGeneration" FROM core.organization_administrator_invitations
    ) p JOIN core.org_invites i ON i.id=p."currentInviteId"
    WHERE i."organizationId"=${orgId}
      AND (i.id=${'id' in target ? target.id : null}
        OR i."emailCanonical"=${'email' in target ? target.email : null})`
}

/** Expired and inconsistent managed pointers must not become ordinary invitations. */
export async function rejectManagedInvitation(
  tx: Prisma.TransactionClient,
  orgId: string,
  target: { id: string } | { email: string }
): Promise<void> {
  if ((await managedInvitationOwners(tx, orgId, target)).length)
    throw provisioningError('PROVISIONING_MANAGED')
}

export async function managedInvitationOwner(
  tx: Prisma.TransactionClient,
  orgId: string,
  inviteId: string
): Promise<ManagedInvitationOwner | undefined> {
  const rows = await managedInvitationOwners(tx, orgId, { id: inviteId })
  const row = rows[0]
  if (
    rows.length > 1 ||
    (row &&
      (row.organizationId !== orgId ||
        row.state !== 'awaiting' ||
        row.currentGeneration !== row.generation))
  )
    throw provisioningError('PROVISIONING_MANAGED')
  return row
}
