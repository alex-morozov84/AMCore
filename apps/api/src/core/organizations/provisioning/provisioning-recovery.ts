import { coerceSupportedLocale, DEFAULT_LOCALE } from '@amcore/shared'
import {
  type ProvisioningCancel,
  provisioningCommandReceiptSchema,
  type ProvisioningReissue,
  type ProvisioningReplace,
} from '@amcore/shared'

import type { OrganizationProvisioning, Prisma } from '../../../generated/prisma/client.js'
import type { BrowserFrontendContext } from '../../frontend-context/frontend-placement.js'
import { issueInvitation } from '../../invitations/invitation-issuance.js'
import { lockInvitationRoles } from '../../invitations/invitation-role-intent.js'
import { clearedProvisioningMail } from '../../invitations/provisioning-settlement.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { invitationClock, lockInvitation } from '../invitation-locks.js'
import {
  completeInvitationOperation,
  invitationFingerprint,
  lockInvitationOperation,
  replayInvitationOperation,
} from '../invitation-operation.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'

import { provisioningError } from './provisioning-error.js'
import { hashProvisioningIntent } from './provisioning-identity.js'
import type { ProvisioningLimiterService } from './provisioning-limiter.service.js'
import {
  newProvisioningAttempt,
  type ProvisioningMail,
  provisioningMailSnapshot,
} from './provisioning-mail.js'
import { lockProvisioningOperator } from './provisioning-transaction.js'

export type ProvisioningCommand =
  | { kind: 'cancel'; input: ProvisioningCancel }
  | { kind: 'reissue'; input: ProvisioningReissue }
  | { kind: 'replace'; input: ProvisioningReplace }

export async function recoverProvisioning(
  tx: Prisma.TransactionClient,
  orgId: string,
  command: ProvisioningCommand,
  operator: SetupOperator,
  limiter: ProvisioningLimiterService,
  assertMailReady: () => void,
  frontend: BrowserFrontendContext
): Promise<{
  receipt: { operationId: string; organizationId: string; revision: number }
  mail: ProvisioningMail | null
}> {
  const hint = await tx.organizationProvisioning.findUnique({ where: { organizationId: orgId } })
  if (!hint) throw provisioningError('PROVISIONING_NOT_FOUND', 404)
  const scope = `provisioning:${hint.operationId}`
  const actorId = operator.principal.sub
  const { operationId, expectedRevision } = command.input
  const intent = { kind: `b07-${command.kind}`, digest: hashProvisioningIntent(command) }
  const receipt = await lockInvitationOperation(tx, actorId, scope, operationId)
  await lockProvisioningOperator(tx, operator)
  const [org] = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM core.organizations WHERE id = ${orgId} FOR UPDATE`
  if (!org) throw provisioningError('PROVISIONING_ORGANIZATION_UNAVAILABLE', 410)
  const replay = await replayInvitationOperation(
    tx,
    receipt,
    operationId,
    invitationFingerprint(intent)
  )
  if (replay !== undefined) {
    return { receipt: provisioningCommandReceiptSchema.parse(replay), mail: null }
  }
  const current = await tx.organizationProvisioning.findUniqueOrThrow({
    where: { organizationId: orgId },
  })
  const roles =
    command.kind === 'cancel'
      ? []
      : await lockInvitationRoles(tx, [await canonicalAdmin(tx)], orgId)
  const invite = current.currentInviteId
    ? await lockInvitation(tx, current.currentInviteId, orgId)
    : undefined
  const [row] = await tx.$queryRaw<
    OrganizationProvisioning[]
  >`SELECT * FROM core.organization_provisionings WHERE "organizationId" = ${orgId} FOR UPDATE`
  if (!row || row.state !== 'awaiting') throw provisioningError('PROVISIONING_CLOSED')
  if (row.revision !== expectedRevision) throw provisioningError('PROVISIONING_STATE_CHANGED')
  let now = await invitationClock(tx)
  if (
    command.kind === 'reissue' &&
    (!invite ||
      invite.id !== command.input.expectedInviteId ||
      invite.generation !== command.input.expectedGeneration ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() + 30 * 86_400_000 <= now.getTime() ||
      invite.generation === 2_147_483_647)
  )
    throw provisioningError('PROVISIONING_INVITATION_UNAVAILABLE')
  if (command.kind !== 'cancel') {
    assertMailReady()
    if (roles[0]?.id !== (await canonicalAdmin(tx)))
      throw provisioningError('SYSTEM_NOT_INITIALIZED', 500)
    const email =
      command.kind === 'replace' ? command.input.firstAdminEmail : invite!.emailCanonical
    await limiter.consume(orgId, email, actorId)
  }
  await admitSetupOperator(tx, operator, true)
  await replayInvitationOperation(tx, null, operationId, invitationFingerprint(intent))
  now = await invitationClock(tx)
  if (command.kind === 'reissue' && invite!.expiresAt.getTime() + 30 * 86_400_000 <= now.getTime())
    throw provisioningError('PROVISIONING_INVITATION_UNAVAILABLE')
  let mail: ProvisioningMail | null = null
  const revision = row.revision + 1
  if (command.kind === 'cancel') {
    if (invite && !invite.acceptedAt && !invite.revokedAt)
      await tx.orgInvite.update({
        where: { id: invite.id },
        data: { revokedAt: now, revokedById: actorId },
      })
    await tx.organizationProvisioning.update({
      where: { operationId: row.operationId },
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
    const email =
      command.kind === 'replace' ? command.input.firstAdminEmail : invite!.emailCanonical
    const locale =
      command.kind === 'replace' ? command.input.inviteLocale : (row.inviteLocale ?? DEFAULT_LOCALE)
    if (command.kind === 'replace' && invite && !invite.acceptedAt && !invite.revokedAt)
      await tx.orgInvite.update({
        where: { id: invite.id },
        data: { revokedAt: now, revokedById: actorId },
      })
    const issued = await issueInvitation(tx, {
      frontend,
      organizationId: orgId,
      email,
      emailCanonical: email,
      actorId,
      roles,
      now,
      ...(command.kind === 'reissue' ? { current: invite! } : {}),
    })
    const attempt = newProvisioningAttempt(issued, now)
    await tx.organizationProvisioning.update({
      where: { operationId: row.operationId },
      data: {
        revision,
        currentInviteId: issued.id,
        currentGeneration: issued.generation,
        inviteLocale: locale,
        ...attempt,
      },
    })
    mail = {
      orgId,
      inviteId: issued.id,
      generation: issued.generation,
      attemptId: attempt.attemptId,
      snapshot: await provisioningMailSnapshot(
        tx,
        { firstAdminEmail: email, inviteLocale: coerceSupportedLocale(locale) },
        orgId,
        actorId,
        issued.token
      ),
    }
  }
  const result = { operationId, organizationId: orgId, revision }
  await tx.auditLog.create({
    data: {
      action: `org.provisioning_${command.kind}`,
      actorId,
      actorType: 'USER',
      organizationId: orgId,
      targetType: 'ORGANIZATION',
      targetId: orgId,
      metadata: { operationId, revision },
    },
  })
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
