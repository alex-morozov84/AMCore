import { randomUUID } from 'node:crypto'

import type { ProvisioningCreate, ProvisioningReceipt } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { BrowserFrontendContext } from '../../frontend-context/frontend-placement.js'
import { issueInvitation } from '../../invitations/invitation-issuance.js'
import { lockInvitationRoles } from '../../invitations/invitation-role-intent.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { invitationClock } from '../invitation-locks.js'
import { generatedOrganizationSlug } from '../organization-creation.service.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'

import { provisioningError } from './provisioning-error.js'
import {
  assertFreshProvisioningId,
  lockProvisioningCreation,
  provisioningAge,
  provisioningFingerprint,
  provisioningReceipt,
} from './provisioning-identity.js'
import type { ProvisioningLimiterService } from './provisioning-limiter.service.js'
import {
  newProvisioningAttempt,
  type ProvisioningMail,
  provisioningMailSnapshot,
} from './provisioning-mail.js'
import { lockProvisioningOperator } from './provisioning-transaction.js'

export async function createProvisioning(
  tx: Prisma.TransactionClient,
  input: ProvisioningCreate,
  operator: SetupOperator,
  limiter: ProvisioningLimiterService,
  assertMailReady: () => void,
  frontend: BrowserFrontendContext
): Promise<{ receipt: ProvisioningReceipt; mail: ProvisioningMail | null }> {
  await lockProvisioningCreation(tx, input.operationId)
  const previous = await tx.organizationProvisioning.findUnique({
    where: { operationId: input.operationId },
  })
  await lockProvisioningOperator(tx, operator, !previous)
  const fingerprint = provisioningFingerprint(input)
  if (previous) {
    if (previous.creatorUserId !== operator.principal.sub)
      throw provisioningError('PROVISIONING_OPERATION_OWNED_BY_OTHER')
    if (previous.fingerprint !== fingerprint)
      throw provisioningError('PROVISIONING_INTENT_MISMATCH')
    return { receipt: provisioningReceipt(previous), mail: null }
  }
  assertFreshProvisioningId(await provisioningAge(tx, input.operationId))
  assertMailReady()
  const orgId = randomUUID()
  const roles = await lockInvitationRoles(tx, [await canonicalAdmin(tx)], orgId)
  await canonicalAdmin(tx)
  await limiter.consume(orgId, input.firstAdminEmail, operator.principal.sub)
  await admitSetupOperator(tx, operator, true)
  assertFreshProvisioningId(await provisioningAge(tx, input.operationId))
  const now = await invitationClock(tx)
  await tx.organization.create({
    data: {
      id: orgId,
      name: input.name,
      slug: input.slug ?? generatedOrganizationSlug(input.name, true),
    },
  })
  const invite = await issueInvitation(tx, {
    frontend,
    organizationId: orgId,
    email: input.firstAdminEmail,
    emailCanonical: input.firstAdminEmail,
    actorId: operator.principal.sub,
    roles,
    now,
  })
  const attempt = newProvisioningAttempt(invite, now)
  const row = await tx.organizationProvisioning.create({
    data: {
      operationId: input.operationId,
      creatorUserId: operator.principal.sub,
      organizationId: orgId,
      fingerprint,
      inviteLocale: input.inviteLocale,
      currentInviteId: invite.id,
      currentGeneration: invite.generation,
      ...attempt,
    },
  })
  await tx.auditLog.create({
    data: {
      action: 'org.created',
      actorId: operator.principal.sub,
      actorType: 'USER',
      organizationId: orgId,
      targetType: 'ORGANIZATION',
      targetId: orgId,
      metadata: {
        source: 'operator-provisioning',
        operationId: input.operationId,
        inviteId: invite.id,
      },
    },
  })
  return {
    receipt: provisioningReceipt(row),
    mail: {
      orgId,
      inviteId: invite.id,
      generation: invite.generation,
      attemptId: attempt.attemptId,
      snapshot: await provisioningMailSnapshot(
        tx,
        input,
        orgId,
        operator.principal.sub,
        invite.token
      ),
    },
  }
}
