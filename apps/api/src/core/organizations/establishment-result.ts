import type { OrganizationSetupIds, OrganizationSetupStatus, OrgResponse } from '@amcore/shared'

import { Prisma } from '../../generated/prisma/client.js'

export const INITIAL_ORGANIZATION_KEY = 'initial-organization'

export interface EstablishmentSnapshot {
  protocolVersion: number
  canonicalInputHash: string
  organizationId: string
  userId: string
  memberId: string
  adminRoleId: string
  adminGrantId: string
  completedAt: Date
  intact: boolean
  name: string | null
  slug: string | null
  aclVersion: number | null
  createdAt: Date | null
  updatedAt: Date | null
}

/** One statement snapshot, no row locks: replay must not invert ordinary ACL writer order. */
export async function readEstablishmentResult(
  tx: Prisma.TransactionClient,
  identity: { actorId: string; operationId: string } | 'bootstrap'
): Promise<EstablishmentSnapshot | undefined> {
  const bootstrap = identity === 'bootstrap'
  const table = bootstrap
    ? Prisma.sql`core.organization_bootstrap_results`
    : Prisma.sql`core.organization_creation_results`
  const user = bootstrap ? Prisma.sql`r."userId"` : Prisma.sql`r."actorId"`
  const predicate = bootstrap
    ? Prisma.sql`r.key = ${INITIAL_ORGANIZATION_KEY}`
    : Prisma.sql`r."actorId" = ${identity.actorId} AND r."operationId" = ${identity.operationId}::uuid`
  const [row] = await tx.$queryRaw<EstablishmentSnapshot[]>(Prisma.sql`
    SELECT r."protocolVersion", r."canonicalInputHash", r."organizationId", ${user} AS "userId",
      r."memberId", r."adminRoleId", r."adminGrantId", r."completedAt",
      (r."protocolVersion" = 1 AND u.id IS NOT NULL AND o.id IS NOT NULL AND m.id IS NOT NULL
        AND g.id IS NOT NULL AND role.id IS NOT NULL
        AND (${!bootstrap} OR u."emailVerified")) AS intact,
      o.name, o.slug, o."aclVersion", o."createdAt", o."updatedAt"
    FROM ${table} r
    LEFT JOIN core.users u ON u.id = ${user}
    LEFT JOIN core.organizations o ON o.id = r."organizationId"
    LEFT JOIN core.org_members m ON m.id = r."memberId" AND m."userId" = ${user}
      AND m."organizationId" = r."organizationId"
    LEFT JOIN core.member_roles g ON g.id = r."adminGrantId" AND g."memberId" = m.id
      AND g."roleId" = r."adminRoleId"
    LEFT JOIN core.roles role ON role.id = r."adminRoleId" AND role.name = 'ADMIN'
      AND role."organizationId" IS NULL AND role."isSystem" = true
    WHERE ${predicate}`)
  return row
}

export function setupCompletion(snapshot: EstablishmentSnapshot): OrganizationSetupStatus {
  return {
    state: snapshot.intact ? 'completed-intact' : 'completed-changed',
    ids: resultIds(snapshot),
    completedAt: snapshot.completedAt.toISOString(),
  }
}

export function resultIds(snapshot: EstablishmentSnapshot): OrganizationSetupIds {
  const { organizationId, userId, memberId, adminRoleId, adminGrantId } = snapshot
  return { organizationId, userId, memberId, adminRoleId, adminGrantId }
}

export function resultOrganization(snapshot: EstablishmentSnapshot): OrgResponse {
  if (
    !snapshot.intact ||
    snapshot.name === null ||
    snapshot.slug === null ||
    snapshot.aclVersion === null ||
    !snapshot.createdAt ||
    !snapshot.updatedAt
  )
    throw new Error('Intact organization result required')
  return {
    id: snapshot.organizationId,
    name: snapshot.name,
    slug: snapshot.slug,
    aclVersion: snapshot.aclVersion,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  }
}
