import { randomUUID } from 'node:crypto'

import type { ProvisioningCreate } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { PrismaService } from '../../../prisma/index.js'
import { lockMarkedProvisioning } from '../../invitations/provisioning-settlement.js'
import type { InvitationEmailService, InvitationMailSnapshot } from '../invitation-email.service.js'
import { invitationClock, lockInvitation, lockInvitationOrg } from '../invitation-locks.js'
import { invitationPostCommit } from '../invitation-post-commit.js'

import { provisioningTransaction } from './provisioning-transaction.js'

export type ProvisioningMail = {
  snapshot: InvitationMailSnapshot
  orgId: string
  inviteId: string
  generation: number
  attemptId: string
  administratorIntentId?: string
}
export function newProvisioningAttempt(
  invite: { id: string; generation: number },
  now: Date
): {
  attemptId: string
  attemptInviteId: string
  attemptGeneration: number
  attemptAt: Date
  mailOutcome: string
  mailObservedAt: null
} {
  return {
    attemptId: randomUUID(),
    attemptInviteId: invite.id,
    attemptGeneration: invite.generation,
    attemptAt: now,
    mailOutcome: 'unconfirmed',
    mailObservedAt: null,
  }
}
export async function provisioningMailSnapshot(
  tx: Prisma.TransactionClient,
  input: Pick<ProvisioningCreate, 'firstAdminEmail' | 'inviteLocale'>,
  orgId: string,
  actorId: string,
  token: string
): Promise<InvitationMailSnapshot> {
  const [org, actor, target] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true, email: true } }),
    tx.user.findUnique({
      where: { emailCanonical: input.firstAdminEmail },
      select: { locale: true },
    }),
  ])
  return {
    email: input.firstAdminEmail,
    token,
    roleNames: ['ADMIN'],
    locale: target?.locale ?? input.inviteLocale,
    hasAccount: !!target,
    orgName: org.name,
    inviterName: actor.name ?? actor.email,
    inviterEmail: actor.email,
  }
}
export async function dispatchProvisioningMail(
  db: PrismaService,
  email: InvitationEmailService,
  mail: ProvisioningMail | null,
  mock: boolean
): Promise<void> {
  if (!mail) return
  const outcome = await invitationPostCommit(async () => {
    await email.dispatch(mail.snapshot)
    await provisioningTransaction(db, async (tx) => {
      const exists = await tx.organization.findUnique({
        where: { id: mail.orgId },
        select: { id: true },
      })
      if (!exists) return
      await lockInvitationOrg(tx, mail.orgId)
      const invite = await lockInvitation(tx, mail.inviteId, mail.orgId)
      if (mail.administratorIntentId) {
        if (!invite || invite.generation !== mail.generation || invite.acceptedAt || invite.revokedAt) return
        await tx.organizationAdministratorInvitation.updateMany({ where: {
          id: mail.administratorIntentId, organizationId: mail.orgId, state: 'awaiting',
          currentInviteId: mail.inviteId, currentGeneration: mail.generation,
          attemptId: mail.attemptId, attemptGeneration: mail.generation, attemptInviteId: mail.inviteId,
        }, data: { mailOutcome: mock ? 'mock' : 'provider_acknowledged', mailObservedAt: await invitationClock(tx) } })
        return
      }
      const row = await lockMarkedProvisioning(tx, mail.inviteId)
      if (
        !invite ||
        !row ||
        row.state !== 'awaiting' ||
        row.attemptId !== mail.attemptId ||
        row.attemptInviteId !== mail.inviteId ||
        row.attemptGeneration !== mail.generation ||
        row.currentGeneration !== mail.generation ||
        invite.generation !== mail.generation
      )
        return
      await tx.organizationProvisioning.update({
        where: { operationId: row.operationId },
        data: {
          mailOutcome: mock ? 'mock' : 'provider_acknowledged',
          mailObservedAt: await invitationClock(tx),
        },
      })
    })
  })
  if (outcome) email.reportOutcome(mail.orgId, outcome)
}
