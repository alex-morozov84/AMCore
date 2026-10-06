import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { PrismaService } from '../../prisma'

import { invitationClock, lockInvitation, lockInvitationOrg } from './invitation-locks'
import { invitationTransaction } from './invitation-transaction'

import type { Prisma } from '@/generated/prisma/client'

const RETENTION_MS = 30 * 86400000
@Injectable()
export class InvitationRetentionService {
  constructor(private readonly prisma: PrismaService) {}

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
        await tx.orgInvite.delete({ where: { id: invite.id } })
        return 1
      })
    return { count }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async pruneAuxiliary(): Promise<void> {
    const now = await invitationClock(this.prisma)
    await this.pruneRows('invitationOperation', {
      completedAt: { lte: new Date(now.getTime() - RETENTION_MS) },
    })
    await this.pruneRows('invitationContinuation', { expiresAt: { lte: now } })
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
