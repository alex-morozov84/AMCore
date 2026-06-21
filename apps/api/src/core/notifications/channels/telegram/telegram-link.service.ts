import { createHash, randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { AuditActorType, AuditTargetType, NotificationDeliveryStatus, Prisma } from '@prisma/client'

import type { TelegramConnectionResponse, TelegramLinkResponse } from '@amcore/shared'

import { PrismaService } from '../../../../prisma'
import { NotificationChannel } from '../../notification.constants'

import { TELEGRAM_LINK_TOKEN_TTL_MS, TelegramCancelReason } from './telegram.constants'

import { AuditLogService } from '@/core/audit/audit-log.service'
import { EnvService } from '@/env/env.service'

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
   * Unlink: transactionally hard-delete the connection and cancel its due deliveries (bounded
   * reason) so no in-flight delivery survives to message a torn-down chat. The unavoidable residual
   * for an already `PROCESSING` send is the documented ADR-052 at-least-once semantics. No-op if
   * the user has no connection.
   */
  async unlink(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const connection = await tx.telegramConnection.findUnique({
        where: { userId },
        select: { id: true },
      })
      if (!connection) return
      await this.cancelDueDeliveries(tx, connection.id, TelegramCancelReason.CONNECTION_UNLINKED)
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

  /** Cancel a connection's `PENDING`/`RETRY_SCHEDULED` telegram deliveries with a bounded reason. */
  private async cancelDueDeliveries(
    tx: Prisma.TransactionClient,
    connectionId: string,
    reason: string
  ): Promise<void> {
    await tx.notificationDelivery.updateMany({
      where: {
        targetRef: connectionId,
        channel: NotificationChannel.TELEGRAM,
        status: {
          in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRY_SCHEDULED],
        },
      },
      data: { status: NotificationDeliveryStatus.CANCELLED, terminalReasonCode: reason },
    })
  }
}
