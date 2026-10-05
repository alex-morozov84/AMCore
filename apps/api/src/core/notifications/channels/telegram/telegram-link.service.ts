import { createHash, randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { TelegramConnectionResponse, TelegramLinkResponse } from '@amcore/shared'

import { PrismaService } from '../../../../prisma'
import { cancelActiveDeliveries } from '../../dispatch/notification-delivery-cancellation'
import { NotificationChannel } from '../../notification.constants'

import { TELEGRAM_LINK_TOKEN_TTL_MS, TelegramCancelReason } from './telegram.constants'

import { AuditLogService } from '@/core/audit/audit-log.service'
import { EnvService } from '@/env/env.service'
import { AuditActorType, AuditTargetType, Prisma } from '@/generated/prisma/client'

/** SHA-256 hex of a raw token — only the hash is ever stored (mirrors reset-token hygiene). */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Bearer-side Telegram linking (web role, Arc D / D.6): issue a one-time deep-link token, read the
 * connection status, and unlink. The webhook side (proving chat ownership) lives in
 * `TelegramWebhookService`; this service never talks to the Bot API. Unlink and the post-bind link
 * event emit bounded `TELEGRAM_CONNECTION` audit events (no chat/user id, no token material).
 */
@Injectable()
export class TelegramLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService
  ) {}

  /** Issue a fresh one-time token and return the `t.me` deep link + its expiry. */
  async issueLink(userId: string): Promise<TelegramLinkResponse> {
    const raw = randomBytes(32).toString('base64url') // 43 chars, base64url
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MS)
    await this.prisma.telegramLinkToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt },
    })
    const botUsername = this.env.get('TELEGRAM_BOT_USERNAME')
    return { url: `https://t.me/${botUsername}?start=${raw}`, expiresAt: expiresAt.toISOString() }
  }

  /** Current connection status (no chat/user id is exposed to the client). */
  async getConnection(userId: string): Promise<TelegramConnectionResponse> {
    const connection = await this.prisma.telegramConnection.findUnique({
      where: { userId },
      select: { status: true, linkedAt: true },
    })
    if (!connection) return { connected: false, status: null, linkedAt: null }
    return {
      connected: true,
      status: connection.status === 'BLOCKED' ? 'blocked' : 'active',
      linkedAt: connection.linkedAt.toISOString(),
    }
  }

  /**
   * Unlink: transactionally hard-delete the connection and cancel ALL its active deliveries
   * (`PENDING`, `RETRY_SCHEDULED` and `PROCESSING`; bounded reason) so no delivery survives to
   * start a NEW send to a torn-down chat or to resurrect through a transient/reaper path. The
   * connection row is locked `FOR UPDATE` first (global lock order: connection → deliveries), so a
   * producer holding `FOR SHARE` commits its delivery before the cancel sees it, and a concurrent
   * unlink/relink finds no row and is a no-op. The unavoidable residual for a send already admitted
   * or on the wire is the documented ADR-052 at-least-once semantics. No-op if the user has no
   * connection.
   */
  async unlink(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [connection] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "notifications"."telegram_connections" WHERE "userId" = ${userId} FOR UPDATE
      `)
      if (!connection) return
      await cancelActiveDeliveries(tx, {
        channel: NotificationChannel.TELEGRAM,
        targetRef: connection.id,
        reason: TelegramCancelReason.CONNECTION_UNLINKED,
      })
      await tx.telegramConnection.delete({ where: { id: connection.id } })
      await this.audit.record(
        {
          action: 'telegram.connection_unlinked',
          actorType: AuditActorType.USER,
          actorId: userId,
          targetType: AuditTargetType.TELEGRAM_CONNECTION,
          targetId: connection.id,
        },
        { tx }
      )
    })
  }
}
