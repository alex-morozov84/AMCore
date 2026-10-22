import { Injectable } from '@nestjs/common'

import type { OrganizationAdministratorInvitation, Prisma } from '../../generated/prisma/client.js'
import {
  errorCode,
  ScheduledJobExecutor,
} from '../../infrastructure/schedule/scheduled-job.executor.js'
import { failed, ScheduledJob, succeeded } from '../../infrastructure/schedule/scheduled-job.js'
import { INVITATION_RETENTION_JOB } from '../../infrastructure/schedule/scheduled-jobs.catalogue.js'
import { PrismaService } from '../../prisma/index.js'

import { invitationClock, lockInvitation, lockInvitationOrg } from './invitation-locks.js'
import { invitationTransaction } from './invitation-transaction.js'
import { clearedProvisioningMail, lockMarkedProvisioning } from './provisioning-settlement.js'

const RETENTION_MS = 30 * 86400000
@Injectable()
export class InvitationRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ScheduledJobExecutor
  ) {}

  async prune(kind: 'pending' | 'terminal'): Promise<{ count: number }> {
    const candidates = await this.prisma.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT id, "organizationId" FROM core.org_invites WHERE
        (${kind} = 'pending' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND
          "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '30 days') OR
        (${kind} = 'terminal' AND ("acceptedAt" <= (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '30 days' OR
          "revokedAt" <= (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '30 days'))
      ORDER BY "organizationId", id LIMIT 1000`
    let count = 0
    for (const candidate of candidates)
      count += await invitationTransaction(this.prisma, async (tx) => {
        const exists = await tx.organization.findUnique({
          where: { id: candidate.organizationId },
          select: { id: true },
        })
        if (!exists) return 0
        await lockInvitationOrg(tx, candidate.organizationId)
        const invite = await lockInvitation(tx, candidate.id, candidate.organizationId)
        const cutoff = new Date((await invitationClock(tx)).getTime() - RETENTION_MS)
        if (!invite) return 0
        const stale =
          kind === 'pending'
            ? !invite.acceptedAt && !invite.revokedAt && invite.expiresAt <= cutoff
            : (invite.acceptedAt && invite.acceptedAt <= cutoff) ||
              (invite.revokedAt && invite.revokedAt <= cutoff)
        if (!stale) return 0
        const provisioning = await lockMarkedProvisioning(tx, invite.id)
        if (provisioning && provisioning.state === 'awaiting')
          await tx.organizationProvisioning.update({
            where: { operationId: provisioning.operationId },
            data: {
              currentInviteId: null,
              currentGeneration: null,
              inviteLocale: null,
              revision: { increment: 1 },
              ...clearedProvisioningMail,
            },
          })
        const [administrator] = await tx.$queryRaw<OrganizationAdministratorInvitation[]>`
          SELECT * FROM core.organization_administrator_invitations WHERE "currentInviteId"=${invite.id} FOR UPDATE`
        if (administrator?.state === 'awaiting')
          await tx.organizationAdministratorInvitation.update({
            where: { id: administrator.id },
            data: {
              currentInviteId: null,
              currentGeneration: null,
              inviteLocale: null,
              revision: { increment: 1 },
              ...clearedProvisioningMail,
            },
          })
        await tx.orgInvite.delete({ where: { id: invite.id } })
        return 1
      })
    return { count }
  }

  /**
   * Runs on every replica (no Redis lock; the steps are idempotent bounded deletes under DB locks).
   * A thrown error is a failed pass; the steps that completed before it are counted, not hidden.
   */
  @ScheduledJob(INVITATION_RETENTION_JOB)
  async pruneAuxiliary(): Promise<void> {
    await this.jobs.run(INVITATION_RETENTION_JOB, async () => {
      let steps = 0
      try {
        await this.pruneAuxiliaryRows(() => (steps += 1))
      } catch (error) {
        return failed(errorCode(error), { counts: { stepsCompleted: steps }, codes: [] })
      }
      return succeeded({ counts: { stepsCompleted: steps }, codes: [] })
    })
  }

  private async pruneAuxiliaryRows(onStep: () => void): Promise<void> {
    const now = await invitationClock(this.prisma)
    await this.pruneRows('invitationOperation', {
      completedAt: { lte: new Date(now.getTime() - RETENTION_MS) },
    })
    onStep()
    await this.pruneRows('invitationContinuation', { expiresAt: { lte: now } })
    onStep()
    const terminal = await this.prisma.organizationAdministratorInvitation.findMany({
      where: {
        OR: [
          { completedAt: { lte: new Date(now.getTime() - RETENTION_MS) } },
          { cancelledAt: { lte: new Date(now.getTime() - RETENTION_MS) } },
        ],
      },
      select: { id: true, organizationId: true },
      take: 1000,
      orderBy: { id: 'asc' },
    })
    for (const row of terminal)
      await invitationTransaction(this.prisma, async (tx) => {
        const exists = await tx.organization.findUnique({
          where: { id: row.organizationId },
          select: { id: true },
        })
        if (!exists) return
        await lockInvitationOrg(tx, row.organizationId)
        await tx.organizationAdministratorInvitation.deleteMany({
          where: {
            id: row.id,
            state: { in: ['completed', 'cancelled'] },
            OR: [
              { completedAt: { lte: new Date(now.getTime() - RETENTION_MS) } },
              { cancelledAt: { lte: new Date(now.getTime() - RETENTION_MS) } },
            ],
          },
        })
      })
    onStep()
    const ids = await this.prisma.invitationAuthHandoff.findMany({
      where: {
        status: { in: ['confirmed', 'aborted'] },
        createdAt: { lte: new Date(now.getTime() - 86400000) },
      },
      select: { attemptId: true },
      take: 1000,
      orderBy: { createdAt: 'asc' },
    })
    await this.prisma.invitationAuthHandoff.deleteMany({
      where: {
        attemptId: { in: ids.map((r) => r.attemptId) },
        status: { in: ['confirmed', 'aborted'] },
        createdAt: { lte: new Date(now.getTime() - 86400000) },
      },
    })
    onStep()
  }

  private async pruneRows(
    kind: 'invitationOperation',
    where: Prisma.InvitationOperationWhereInput
  ): Promise<void>
  private async pruneRows(
    kind: 'invitationContinuation',
    where: Prisma.InvitationContinuationWhereInput
  ): Promise<void>
  private async pruneRows(
    kind: 'invitationOperation' | 'invitationContinuation',
    where: Prisma.InvitationOperationWhereInput | Prisma.InvitationContinuationWhereInput
  ): Promise<void> {
    if (kind === 'invitationOperation') {
      const query = where as Prisma.InvitationOperationWhereInput
      const rows = await this.prisma.invitationOperation.findMany({
        where: query,
        select: { id: true },
        take: 1000,
        orderBy: { completedAt: 'asc' },
      })
      await this.prisma.invitationOperation.deleteMany({
        where: { AND: [query, { id: { in: rows.map((r) => r.id) } }] },
      })
    } else {
      const query = where as Prisma.InvitationContinuationWhereInput
      const rows = await this.prisma.invitationContinuation.findMany({
        where: query,
        select: { id: true },
        take: 1000,
        orderBy: { expiresAt: 'asc' },
      })
      await this.prisma.invitationContinuation.deleteMany({
        where: { AND: [query, { id: { in: rows.map((r) => r.id) } }] },
      })
    }
  }
}
