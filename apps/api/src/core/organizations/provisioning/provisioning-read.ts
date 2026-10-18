import type { ProvisioningProgress } from '@amcore/shared'

import type { OrganizationProvisioning, Prisma } from '../../../generated/prisma/client.js'
import { hasCanonicalTemplate } from '../system-template-validation.js'

import { provisioningError } from './provisioning-error.js'

type Template = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } }
}>
type Snapshot = OrganizationProvisioning & {
  available: boolean
  grantPresent: boolean
  templates: Template[]
  now: Date
  invite: {
    id: string
    generation: number
    email: string
    expiresAt: string
    unavailable: boolean
  } | null
}

/** One statement snapshot, including original grant and template permission facts. */
export async function readProvisioning(
  tx: Prisma.TransactionClient,
  orgId: string,
  policy: ProvisioningProgress['policy']
): Promise<ProvisioningProgress> {
  const [row] = await tx.$queryRaw<Snapshot[]>`
    SELECT p.*, o.id IS NOT NULL AS available, g.id IS NOT NULL AND u.id IS NOT NULL AS "grantPresent",
      date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS now,
      CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object('id',i.id,'generation',i.generation,
        'email',i.email,'expiresAt',to_char(i."expiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'unavailable', i."intentInvalid" OR i."revokedAt" IS NOT NULL OR i."acceptedAt" IS NOT NULL) END AS invite,
      COALESCE((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('permissions',
        COALESCE((SELECT jsonb_agg(to_jsonb(rp) || jsonb_build_object('permission',to_jsonb(pm)))
          FROM core.role_permissions rp JOIN core.permissions pm ON pm.id=rp."permissionId" WHERE rp."roleId"=r.id),'[]'::jsonb)))
        FROM core.roles r WHERE r.name='ADMIN' AND r."organizationId" IS NULL),'[]'::jsonb) AS templates
    FROM core.organization_provisionings p
    LEFT JOIN core.organizations o ON o.id=p."organizationId"
    LEFT JOIN core.org_invites i ON i.id=p."currentInviteId" AND i."organizationId"=p."organizationId"
    LEFT JOIN core.org_members m ON m.id=p."originalMemberId" AND m."userId"=p."originalAdminUserId" AND m."organizationId"=p."organizationId"
    LEFT JOIN core.users u ON u.id=m."userId"
    LEFT JOIN core.member_roles g ON g.id=p."originalAdminGrantId" AND g."memberId"=m.id AND g."roleId"=p."originalAdminRoleId"
    WHERE p."organizationId"=${orgId}`
  if (!row) throw provisioningError('PROVISIONING_NOT_FOUND', 404)
  const canonical =
    row.templates.length === 1 &&
    row.templates[0]?.id === row.originalAdminRoleId &&
    hasCanonicalTemplate(row.templates[0])
  const access: ProvisioningProgress['access'] =
    row.state !== 'completed'
      ? 'not_established'
      : !canonical
        ? 'unconfirmed'
        : row.available && row.grantPresent
          ? 'original_grant_present'
          : 'removed'
  return {
    organizationId: orgId,
    creationOperationId: row.operationId,
    available: row.available,
    revision: row.revision,
    state: row.state as ProvisioningProgress['state'],
    invite:
      row.state === 'awaiting' && row.available && row.invite
        ? {
            id: row.invite.id,
            generation: row.invite.generation,
            email: row.invite.email,
            expiresAt: row.invite.expiresAt,
            status: row.invite.unavailable
              ? 'unavailable'
              : Date.parse(row.invite.expiresAt) <= row.now.getTime()
                ? 'expired'
                : 'pending',
          }
        : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    access,
    mailOutcome: row.available ? (row.mailOutcome as ProvisioningProgress['mailOutcome']) : null,
    policy,
  }
}
