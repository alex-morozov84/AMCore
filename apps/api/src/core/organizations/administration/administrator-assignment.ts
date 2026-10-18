import type { AdministratorAssignment } from '@amcore/shared'

import type {
  OrganizationAdministratorInvitation,
  OrganizationProvisioning,
  Prisma,
} from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/advisory-lock.js'
import type { AuditLogService } from '../../audit/index.js'
import { completeAdministratorInvitation } from '../../invitations/administrator-settlement.js'
import { lockInvitationRoles } from '../../invitations/invitation-role-intent.js'
import { completeProvisioning } from '../../invitations/provisioning-settlement.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { invitationClock, lockInvitation, lockInvitationUser } from '../invitation-locks.js'
import {
  completeInvitationOperation,
  invitationFingerprint,
  replayInvitationOperation,
} from '../invitation-operation.js'
import { lockOrganizationMembers } from '../organization-mutation-lock.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'
import { provisioningError as fail } from '../provisioning/provisioning-error.js'
import { hashProvisioningIntent } from '../provisioning/provisioning-identity.js'

import { administratorAudit } from './administrator-audit.js'
import {
  lockAdministratorOperation,
  rejectAdministratorCreationIdentity,
} from './administrator-operation.js'

/** Lock users before the parent; an exact retained replay never restores removed access. */
export async function assignAdministrator(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: AdministratorAssignment,
  operator: SetupOperator,
  audit: AuditLogService
): Promise<Prisma.JsonValue> {
  const actorId = operator.principal.sub
  const scope = `administrator:${orgId}`
  const intent = { kind: 'administrator-assign', digest: hashProvisioningIntent(input) }
  const receipt = await lockAdministratorOperation(tx, actorId, orgId, input.operationId)
  if (operator.principal.organizationId) throw fail('FORBIDDEN', 403)
  await acquireXactLock(tx, 'system-role:SUPER_ADMIN')
  const users = new Map<string, Awaited<ReturnType<typeof lockInvitationUser>>>()
  for (const id of [...new Set([actorId, input.userId])].sort())
    users.set(id, await lockInvitationUser(tx, id))
  await admitSetupOperator(tx, operator, true)
  const org = await lockOrganizationMembers(tx, orgId)
  await rejectAdministratorCreationIdentity(tx, input.operationId)
  const replay = await replayInvitationOperation(
    tx,
    receipt,
    input.operationId,
    invitationFingerprint(intent)
  )
  if (replay !== undefined) return replay
  const target = users.get(input.userId)
  if (!target) throw fail('ADMIN_MEMBER_UNAVAILABLE')
  if (!target.emailVerified) throw fail('ADMIN_MEMBER_UNVERIFIED')
  const adminId = await canonicalAdmin(tx)
  await lockInvitationRoles(tx, [adminId], orgId)
  if ((await canonicalAdmin(tx)) !== adminId) throw fail('SYSTEM_NOT_INITIALIZED', 500)
  const initial = await tx.organizationProvisioning.findFirst({
    where: { organizationId: orgId, state: 'awaiting' },
  })
  const additions = await tx.organizationAdministratorInvitation.findMany({
    where: {
      organizationId: orgId,
      state: 'awaiting',
      currentInvite: { emailCanonical: target.emailCanonical },
    },
    orderBy: { id: 'asc' },
  })
  const inviteIds = [
    ...new Set(
      [initial?.currentInviteId, ...additions.map((r) => r.currentInviteId)].filter(
        (id): id is string => !!id
      )
    ),
  ].sort()
  for (const id of inviteIds) await lockInvitation(tx, id, orgId)
  const [member] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM core.org_members WHERE "organizationId"=${orgId} AND "userId"=${input.userId} FOR UPDATE`
  if (!member || member.id !== input.expectedMemberId) throw fail('ADMIN_MEMBER_UNAVAILABLE')
  if (org.aclVersion !== input.expectedAclVersion) throw fail('ADMIN_ASSIGNMENT_CONFLICT')
  if (initial)
    await tx.$queryRaw<OrganizationProvisioning[]>`
    SELECT * FROM core.organization_provisionings WHERE "operationId"=${initial.operationId}::uuid FOR UPDATE`
  for (const row of additions)
    await tx.$queryRaw<OrganizationAdministratorInvitation[]>`
    SELECT * FROM core.organization_administrator_invitations WHERE id=${row.id}::uuid FOR UPDATE`
  await admitSetupOperator(tx, operator, true)
  await replayInvitationOperation(tx, null, input.operationId, invitationFingerprint(intent))
  const now = await invitationClock(tx)
  const current = await tx.memberRole.findUnique({
    where: { memberId_roleId: { memberId: member.id, roleId: adminId } },
  })
  const grant =
    current ?? (await tx.memberRole.create({ data: { memberId: member.id, roleId: adminId } }))
  if (!current)
    await tx.organization.update({ where: { id: orgId }, data: { aclVersion: { increment: 1 } } })
  if (inviteIds.length)
    await tx.orgInvite.updateMany({
      where: { id: { in: inviteIds }, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now, revokedById: actorId },
    })
  if (initial) await completeProvisioning(tx, initial, input.userId, member.id, adminId, now)
  for (const row of additions)
    await completeAdministratorInvitation(
      tx,
      audit,
      { kind: 'additional', row },
      input.userId,
      member.id,
      adminId,
      now
    )
  const result = {
    operationId: input.operationId,
    organizationId: orgId,
    userId: input.userId,
    memberId: member.id,
    adminGrantId: grant.id,
    aclVersion: org.aclVersion + (current ? 0 : 1),
    changed: !current,
  }
  await administratorAudit(audit, tx, 'org.administrator_assigned', orgId, actorId, input.reason, {
    operationId: input.operationId,
    memberId: member.id,
    adminGrantId: grant.id,
    changed: !current,
  })
  await completeInvitationOperation(tx, {
    actorId,
    organizationId: orgId,
    scope,
    operationId: input.operationId,
    kind: intent.kind,
    intent,
    result,
  })
  return result
}
