import {
  type AdministratorAttention,
  type AdministratorAttentionQuery,
  administratorAttentionSchema,
  type AdministratorInvitationProgress,
  administratorInvitationProgressSchema,
  type ProvisioningProgress,
} from '@amcore/shared'

import type {
  OrganizationAdministratorInvitation,
  Prisma,
} from '../../../generated/prisma/client.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { provisioningError as fail } from '../provisioning/provisioning-error.js'

/** Caller supplies one repeatable-read transaction for all authority and projection reads. */
export async function readAdministratorInvitation(
  tx: Prisma.TransactionClient,
  orgId: string,
  id: string
): Promise<AdministratorInvitationProgress> {
  const row = await tx.organizationAdministratorInvitation.findUnique({
    where: { id },
    include: { currentInvite: true },
  })
  if (!row || row.organizationId !== orgId) throw fail('ADMIN_INVITATION_NOT_FOUND', 404)
  return administratorProgress(row, row.currentInvite, new Date())
}
export function administratorProgress(
  row: OrganizationAdministratorInvitation,
  invite: {
    id: string
    generation: number
    email: string
    expiresAt: Date
    intentInvalid: boolean
    revokedAt: Date | null
    acceptedAt: Date | null
  } | null,
  now: Date
): AdministratorInvitationProgress {
  return administratorInvitationProgressSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    revision: row.revision,
    state: row.state,
    invite:
      row.state === 'awaiting' && invite
        ? {
            id: invite.id,
            generation: invite.generation,
            email: invite.email,
            expiresAt: invite.expiresAt.toISOString(),
            status:
              invite.intentInvalid ||
              invite.revokedAt ||
              invite.acceptedAt ||
              invite.generation !== row.currentGeneration
                ? 'unavailable'
                : invite.expiresAt <= now
                  ? 'expired'
                  : 'pending',
          }
        : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    mailOutcome: row.mailOutcome as ProvisioningProgress['mailOutcome'],
  })
}
export async function readAdministratorAttention(
  tx: Prisma.TransactionClient,
  input: AdministratorAttentionQuery
): Promise<AdministratorAttention> {
  const adminId = await canonicalAdmin(tx)
  const search = input.search ?? ''
  const [result] = await tx.$queryRaw<{ result: unknown }[]>`
    WITH all_orgs AS (
      SELECT o.id AS "organizationId", o.name, o.slug, o."createdAt",
        (SELECT count(*)::int FROM core.member_roles r JOIN core.org_members m ON m.id=r."memberId"
          WHERE m."organizationId"=o.id AND r."roleId"=${adminId}) AS "adminCount",
        (SELECT count(*)::int FROM core.organization_provisionings p WHERE p."organizationId"=o.id AND p.state='awaiting') +
        (SELECT count(*)::int FROM core.organization_administrator_invitations a WHERE a."organizationId"=o.id AND a.state='awaiting') AS "pendingAdminInvitationCount",
        ARRAY(SELECT DISTINCT reason FROM (
          SELECT 'no_administrator'::text AS reason WHERE NOT EXISTS (
            SELECT 1 FROM core.member_roles r JOIN core.org_members m ON m.id=r."memberId" WHERE m."organizationId"=o.id AND r."roleId"=${adminId})
          UNION ALL
          SELECT CASE WHEN i.id IS NULL THEN 'recipient_required'
            WHEN i."intentInvalid" OR i."acceptedAt" IS NOT NULL OR i."revokedAt" IS NOT NULL OR i.generation<>p.generation THEN 'invitation_unavailable'
            WHEN i."expiresAt"<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'pending' END
          FROM (
            SELECT "currentInviteId" AS invite_id, "currentGeneration" AS generation FROM core.organization_provisionings WHERE "organizationId"=o.id AND state='awaiting'
            UNION ALL SELECT "currentInviteId", "currentGeneration" FROM core.organization_administrator_invitations WHERE "organizationId"=o.id AND state='awaiting'
          ) p LEFT JOIN core.org_invites i ON i.id=p.invite_id
          UNION ALL SELECT 'mail_unconfirmed' WHERE EXISTS (
            SELECT 1 FROM core.organization_provisionings WHERE "organizationId"=o.id AND state='awaiting' AND "mailOutcome"='unconfirmed'
            UNION ALL SELECT 1 FROM core.organization_administrator_invitations WHERE "organizationId"=o.id AND state='awaiting' AND "mailOutcome"='unconfirmed'
          )
        ) reasons ORDER BY reason) AS reasons
      FROM core.organizations o
    ), attention AS (
      SELECT * FROM all_orgs WHERE ("adminCount"=0 OR "pendingAdminInvitationCount">0)
        AND (strpos(lower(name),lower(${search}))>0 OR strpos(lower(slug),lower(${search}))>0)
    ), page AS (
      SELECT * FROM attention ORDER BY "createdAt" DESC,"organizationId" LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}
    ) SELECT jsonb_build_object('total',(SELECT count(*)::int FROM attention),
      'organizationTotal',(SELECT count(*)::int FROM all_orgs),'page',${input.page}::int,'limit',${input.limit}::int,
      'data',COALESCE((SELECT jsonb_agg(to_jsonb(page)-'createdAt' ORDER BY "createdAt" DESC,"organizationId") FROM page),'[]'::jsonb)) AS result`
  return administratorAttentionSchema.parse(result!.result)
}
