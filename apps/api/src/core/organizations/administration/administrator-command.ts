import type {
  AdministratorCommandReceipt,
  AdministratorInvitationCancel,
  AdministratorInvitationCreate,
  AdministratorInvitationReissue,
  AdministratorInvitationReplace,
} from '@amcore/shared'
import { coerceSupportedLocale, DEFAULT_LOCALE } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type {
  OrganizationAdministratorInvitation,
  OrgInvite,
  Prisma,
} from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/advisory-lock.js'
import type { AuditLogService } from '../../audit/index.js'
import { issueInvitation } from '../../invitations/invitation-issuance.js'
import { lockInvitationRoles } from '../../invitations/invitation-role-intent.js'
import {
  managedInvitationOwner,
  rejectManagedInvitation,
} from '../../invitations/managed-invitation.js'
import { clearedProvisioningMail } from '../../invitations/provisioning-settlement.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { invitationClock, lockInvitation, lockInvitationOrg } from '../invitation-locks.js'
import {
  completeInvitationOperation,
  invitationFingerprint,
  replayInvitationOperation,
} from '../invitation-operation.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'
import { provisioningError as fail } from '../provisioning/provisioning-error.js'
import { hashProvisioningIntent, provisioningAge } from '../provisioning/provisioning-identity.js'
import type { ProvisioningLimiterService } from '../provisioning/provisioning-limiter.service.js'
import {
  newProvisioningAttempt,
  type ProvisioningMail,
  provisioningMailSnapshot,
} from '../provisioning/provisioning-mail.js'
import { lockProvisioningOperator } from '../provisioning/provisioning-transaction.js'

import { administratorAudit } from './administrator-audit.js'
import {
  lockAdministratorOperation,
  rejectAdministratorCreationIdentity,
} from './administrator-operation.js'

export type AdministratorCommand =
  | { kind: 'create'; input: AdministratorInvitationCreate }
  | { kind: 'reissue'; id: string; input: AdministratorInvitationReissue }
  | { kind: 'replace'; id: string; input: AdministratorInvitationReplace }
  | { kind: 'cancel'; id: string; input: AdministratorInvitationCancel }

type Dependencies = {
  operator: SetupOperator
  limiter: ProvisioningLimiterService
  audit: AuditLogService
  assertMailReady: () => void
}

/** All pending work and mail facts commit together; dispatch is strictly postcommit. */
export async function administratorCommand(
  tx: Prisma.TransactionClient,
  orgId: string,
  command: AdministratorCommand,
  deps: Dependencies
): Promise<{ receipt: Prisma.JsonValue; mail: ProvisioningMail | null }> {
  const { operator, limiter, audit } = deps
  const actorId = operator.principal.sub
  const { operationId, reason } = command.input
  const scope = `administrator:${orgId}`
  const intent = { kind: `administrator-${command.kind}`, digest: hashProvisioningIntent(command) }
  const fingerprint = invitationFingerprint(intent)
  const receipt = await lockAdministratorOperation(tx, actorId, orgId, operationId)
  await lockProvisioningOperator(tx, operator)
  const hint =
    command.kind === 'create'
      ? undefined
      : await tx.organizationAdministratorInvitation.findUnique({ where: { id: command.id } })
  const priorInvite = hint?.currentInviteId
    ? await tx.orgInvite.findUnique({ where: { id: hint.currentInviteId } })
    : null
  const email =
    command.kind === 'create' || command.kind === 'replace'
      ? command.input.email
      : priorInvite?.emailCanonical
  if (email && command.kind !== 'cancel') await acquireXactLock(tx, `org-invite:${orgId}:${email}`)
  await lockInvitationOrg(tx, orgId)
  if (command.kind !== 'create') {
    await rejectAdministratorCreationIdentity(tx, operationId)
    const replay = await replayInvitationOperation(tx, receipt, operationId, fingerprint)
    if (replay !== undefined) return { receipt: replay, mail: null }
  } else {
    if (receipt) throw fail('ADMIN_INTENT_MISMATCH')
    const replay = await tx.organizationAdministratorInvitation.findUnique({
      where: { id: operationId },
    })
    if (replay) {
      if (replay.creatorUserId !== actorId) throw fail('ADMIN_OPERATION_OWNED_BY_OTHER')
      if (replay.organizationId !== orgId || replay.fingerprint !== fingerprint)
        throw fail('ADMIN_INTENT_MISMATCH')
      return { receipt: commandReceipt(operationId, replay, 1), mail: null }
    }
  }
  const age = await provisioningAge(tx, operationId)
  if (age > 86400000 || age < -300000) throw fail('ADMIN_OPERATION_EXPIRED')
  if (
    command.kind === 'create' &&
    (await tx.organizationProvisioning.findFirst({
      where: { organizationId: orgId, state: 'awaiting' },
    }))
  )
    throw fail('ADMIN_INITIAL_SETUP_PENDING')
  if (command.kind !== 'create' && (!hint || hint.organizationId !== orgId))
    throw fail('ADMIN_INVITATION_NOT_FOUND', 404)
  const roles =
    command.kind === 'cancel'
      ? []
      : await lockInvitationRoles(tx, [await canonicalAdmin(tx)], orgId)
  if (command.kind !== 'cancel') await canonicalAdmin(tx)
  const collision =
    email && command.kind !== 'cancel'
      ? await tx.orgInvite.findFirst({
          where: {
            organizationId: orgId,
            emailCanonical: email,
            acceptedAt: null,
            revokedAt: null,
          },
        })
      : null
  const ids = [
    ...new Set([hint?.currentInviteId, collision?.id].filter((x): x is string => !!x)),
  ].sort()
  const invites = new Map<string, OrgInvite>()
  for (const id of ids) {
    const invite = await lockInvitation(tx, id, orgId)
    if (invite) invites.set(id, invite)
  }
  let row: OrganizationAdministratorInvitation | undefined
  if (command.kind !== 'create') {
    const rows = await tx.$queryRaw<OrganizationAdministratorInvitation[]>`
      SELECT * FROM core.organization_administrator_invitations WHERE id=${command.id}::uuid FOR UPDATE`
    row = rows[0]
    if (!row || row.state !== 'awaiting') throw fail('ADMIN_INVITATION_CLOSED')
    if (row.revision !== command.input.expectedRevision) throw fail('ADMIN_INVITATION_CONFLICT')
  }
  const current = row?.currentInviteId ? invites.get(row.currentInviteId) : undefined
  if (row?.currentInviteId) {
    if (!current) throw fail('ADMIN_INVITATION_CONFLICT')
    const owner = await managedInvitationOwner(tx, orgId, current.id)
    if (owner?.kind !== 'additional' || owner.id !== row.id) throw fail('ADMIN_INVITATION_CONFLICT')
  }
  if (
    command.kind === 'reissue' &&
    (!current ||
      current.id !== command.input.expectedInviteId ||
      current.generation !== command.input.expectedGeneration ||
      current.acceptedAt ||
      current.revokedAt ||
      current.intentInvalid ||
      current.generation === 2147483647 ||
      current.expiresAt.getTime() + 30 * 86400000 <= (await invitationClock(tx)).getTime())
  )
    throw fail('ADMIN_INVITATION_CONFLICT')
  if (collision && collision.id !== current?.id) {
    await rejectManagedInvitation(tx, orgId, { id: collision.id })
    if (command.kind !== 'create' || !command.input.supersedesInvite)
      throw new AppException('Pending invitation', 409, 'ADMIN_INVITATION_ALREADY_PENDING', {
        supersedesInvite: { id: collision.id, generation: collision.generation },
      })
    const expected = command.input.supersedesInvite
    if (
      expected.id !== collision.id ||
      expected.generation !== collision.generation ||
      collision.emailCanonical !== email
    )
      throw fail('ADMIN_INVITATION_CONFLICT')
  } else if (command.kind === 'create' && command.input.supersedesInvite)
    throw fail('ADMIN_INVITATION_CONFLICT')
  if (command.kind !== 'cancel') {
    const target = await tx.user.findUnique({
      where: { emailCanonical: email! },
      select: { id: true },
    })
    const member =
      target &&
      (await tx.orgMember.findUnique({
        where: { userId_organizationId: { userId: target.id, organizationId: orgId } },
      }))
    if (member)
      throw new AppException(
        'Select the member for explicit assignment',
        409,
        'ADMIN_MEMBER_ASSIGNMENT_REQUIRED',
        { userId: target!.id, memberId: member.id }
      )
    deps.assertMailReady()
    await limiter.consume(orgId, email!, actorId)
  }
  await admitSetupOperator(tx, operator, true)
  if (command.kind === 'create') {
    const finalAge = await provisioningAge(tx, operationId)
    if (finalAge > 86400000 || finalAge < -300000) throw fail('ADMIN_OPERATION_EXPIRED')
  } else await replayInvitationOperation(tx, null, operationId, fingerprint)
  const now = await invitationClock(tx)
  if (command.kind === 'reissue' && current!.expiresAt.getTime() + 30 * 86400000 <= now.getTime())
    throw fail('ADMIN_INVITATION_CONFLICT')
  const revision = (row?.revision ?? 0) + 1
  let mail: ProvisioningMail | null = null
  if (command.kind === 'cancel') {
    if (current && !current.acceptedAt && !current.revokedAt)
      await tx.orgInvite.update({
        where: { id: current.id },
        data: { revokedAt: now, revokedById: actorId },
      })
    row = await tx.organizationAdministratorInvitation.update({
      where: { id: row!.id },
      data: {
        state: 'cancelled',
        cancelledAt: now,
        revision,
        currentInviteId: null,
        currentGeneration: null,
        inviteLocale: null,
        ...clearedProvisioningMail,
      },
    })
  } else {
    if (command.kind === 'replace' && current && !current.acceptedAt && !current.revokedAt)
      await tx.orgInvite.update({
        where: { id: current.id },
        data: { revokedAt: now, revokedById: actorId },
      })
    if (collision && collision.id !== current?.id)
      await tx.orgInvite.update({
        where: { id: collision.id },
        data: { revokedAt: now, revokedById: actorId },
      })
    const issued = await issueInvitation(tx, {
      organizationId: orgId,
      email: email!,
      emailCanonical: email!,
      actorId,
      roles,
      now,
      ...(command.kind === 'reissue' ? { current: current! } : {}),
    })
    const attempt = newProvisioningAttempt(issued, now)
    const locale =
      command.kind === 'reissue'
        ? (row!.inviteLocale ?? DEFAULT_LOCALE)
        : command.input.inviteLocale
    const data = {
      revision,
      currentInviteId: issued.id,
      currentGeneration: issued.generation,
      inviteLocale: locale,
      ...attempt,
    }
    row =
      command.kind === 'create'
        ? await tx.organizationAdministratorInvitation.create({
            data: {
              ...data,
              id: operationId,
              organizationId: orgId,
              creatorUserId: actorId,
              fingerprint,
            },
          })
        : await tx.organizationAdministratorInvitation.update({ where: { id: row!.id }, data })
    mail = {
      orgId,
      inviteId: issued.id,
      generation: issued.generation,
      attemptId: attempt.attemptId,
      administratorIntentId: row.id,
      snapshot: await provisioningMailSnapshot(
        tx,
        { firstAdminEmail: email!, inviteLocale: coerceSupportedLocale(locale) },
        orgId,
        actorId,
        issued.token
      ),
    }
  }
  const result = commandReceipt(operationId, row!, revision)
  const action = {
    create: 'org.administrator_invitation_created',
    reissue: 'org.administrator_invitation_reissued',
    replace: 'org.administrator_invitation_replaced',
    cancel: 'org.administrator_invitation_cancelled',
  } as const
  await administratorAudit(audit, tx, action[command.kind], orgId, actorId, reason, {
    operationId,
    administratorInvitationId: row!.id,
    revision,
  })
  if (command.kind !== 'create')
    await completeInvitationOperation(tx, {
      actorId,
      organizationId: orgId,
      scope,
      operationId,
      kind: intent.kind,
      intent,
      result,
    })
  return { receipt: result, mail }
}

function commandReceipt(
  operationId: string,
  row: OrganizationAdministratorInvitation,
  revision: number
): AdministratorCommandReceipt {
  return {
    operationId,
    organizationId: row.organizationId,
    administratorInvitationId: row.id,
    revision,
  }
}
