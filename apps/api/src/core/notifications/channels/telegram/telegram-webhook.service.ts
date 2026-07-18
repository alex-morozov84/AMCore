import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../../../prisma'
import { NotificationsService } from '../../notifications.service'

import { bindFromUpdate, type BindResult } from './telegram-bind'
import { parseStartCommand, parseUpdateId } from './telegram-update.schema'

import { AuditLogService } from '@/core/audit/audit-log.service'
import { EnvService } from '@/env/env.service'
import { AuditActorType, AuditTargetType } from '@/generated/prisma/client'

/**
 * Inbound Telegram webhook handler (web role, Arc D / D.6). Orchestrates the **single transaction**
 * (`bindFromUpdate`, R1–R6) that dedupes the update, validates the `/start` command, and binds the
 * chat — consuming the one-time token ONLY on a fully successful bind. A permanent business
 * rejection commits the durable receipt and acks 200; a transient/race failure rolls back → 5xx so
 * Telegram retries and converges. The Bot API client is never imported here — the confirmation is
 * produced through `notify()` (worker-only outbound).
 */
@Injectable()
export class TelegramWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(TelegramWebhookService.name)
  }

  /**
   * Process one update. Resolves (→ controller acks 200) for both a successful bind and every
   * durable no-op; throws (→ 5xx) only on a transient/infra/race failure that should be retried.
   */
  async processUpdate(body: unknown): Promise<void> {
    const updateId = parseUpdateId(body)
    // No safe `update_id` → no dedupe key at all → ack without a receipt (R4).
    if (updateId === undefined) return

    const command = parseStartCommand(body, this.env.get('TELEGRAM_BOT_USERNAME') ?? '')
    const bound = await this.prisma.$transaction((tx) => bindFromUpdate(tx, updateId, command))

    // Post-commit only, best-effort — failure must never turn a committed receipt into a 5xx.
    if (bound) await this.afterBind(bound)
  }

  /** Post-commit confirmation (through the channel) + bounded audit. Best-effort; never throws. */
  private async afterBind(bind: BindResult): Promise<void> {
    try {
      await this.notifications.notify({
        recipientUserId: bind.userId,
        type: 'account.telegram_linked',
        payload: {},
        idempotencyKey: `telegram.linked:${bind.connectionId}`,
      })
    } catch (err) {
      this.logger.warn(
        {
          event: 'telegram.confirmation_failed',
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Telegram link confirmation failed (non-fatal)'
      )
    }
    await this.audit.record({
      action: 'telegram.connection_linked',
      actorType: AuditActorType.USER,
      actorId: bind.userId,
      targetType: AuditTargetType.TELEGRAM_CONNECTION,
      targetId: bind.connectionId,
    })
  }
}
