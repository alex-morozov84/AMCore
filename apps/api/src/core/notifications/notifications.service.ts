import { Injectable } from '@nestjs/common'
import { NotificationDeliveryStatus, type Prisma } from '@prisma/client'
import { z } from 'zod'

import { type NotificationAction, notificationActionSchema } from '@amcore/shared'

import { PrismaService } from '../../prisma'

import { NotificationChannel } from './notification.constants'
import { NotificationIdempotencyConflictError } from './notification.errors'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinition } from './notification-definition.types'
import { notificationFingerprint } from './notification-fingerprint'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'

/** Input a trusted module passes to create a notification. */
export interface NotifyInput {
  recipientUserId: string
  type: string
  payload: unknown
  /** Namespaced occurrence key, required — the dedupe identity (ADR-052). */
  idempotencyKey: string
  organizationId?: string | null
  /** Domain event time; defaults to now. */
  occurredAt?: Date
}

export interface NotifyResult {
  notificationId: string
  /** false on an idempotent replay (same key + fingerprint). */
  created: boolean
  /** Channels actually persisted as deliveries (not a fresh resolution). */
  channels: NotificationChannel[]
}

interface NotifyPlan {
  definition: NotificationDefinition
  payload: unknown
  fingerprint: string
  action: NotificationAction | null
  channels: NotificationChannel[]
  locale: string
}

const DEFAULT_LOCALE = 'ru'

const NOTIFICATION_IDEMPOTENCY_KEY_MAX = 255

/**
 * A namespaced occurrence key (ADR-052): a dotted lowercase namespace, a `:`
 * separator, then a bounded occurrence id with no whitespace/control characters —
 * e.g. `account.profile_updated:<occurrence-id>`. An unnamespaced bare key is rejected.
 */
const NOTIFICATION_IDEMPOTENCY_KEY_GRAMMAR =
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*:[A-Za-z0-9._:-]+$/

/**
 * Internal contract for producer input not covered by the per-type payload schema:
 * a non-empty recipient and a bounded, namespaced idempotency key — both reach an
 * indexed column, so guard them before hashing/writing (cold-review finding 5).
 */
const notifyContractSchema = z.object({
  recipientUserId: z.string().min(1),
  idempotencyKey: z
    .string()
    .max(NOTIFICATION_IDEMPOTENCY_KEY_MAX)
    .regex(NOTIFICATION_IDEMPOTENCY_KEY_GRAMMAR),
})

/**
 * Producer for notifications (ADR-052). `notify` owns its transaction; `notifyTx`
 * writes on the caller's transaction so a notification can be atomic with a business
 * mutation (precedent: `AuditLogService.record({ tx })`). There is no public generic
 * create endpoint — only trusted modules call this typed contract.
 *
 * Arc A materializes only the in-app channel (inserted DELIVERED in the same
 * transaction, so the feed never depends on the worker). External channels are
 * resolved but not yet created — their adapters and PENDING deliveries arrive in
 * Arc B, additively.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationDefinitionRegistry,
    private readonly resolver: NotificationPreferenceResolver,
    private readonly preferences: NotificationPreferenceRepository
  ) {}

  async notify(input: NotifyInput): Promise<NotifyResult> {
    return this.prisma.$transaction((tx) => this.run(tx, input))
  }

  async notifyTx(tx: Prisma.TransactionClient, input: NotifyInput): Promise<NotifyResult> {
    return this.run(tx, input)
  }

  // Build + write on the SAME client so resolution reads and the inserts share one
  // transactional snapshot (critical for notifyTx — the caller's transaction).
  private async run(client: Prisma.TransactionClient, input: NotifyInput): Promise<NotifyResult> {
    const plan = await this.buildPlan(client, input)
    return this.write(client, input, plan)
  }

  private async buildPlan(
    client: Prisma.TransactionClient,
    input: NotifyInput
  ): Promise<NotifyPlan> {
    notifyContractSchema.parse({
      recipientUserId: input.recipientUserId,
      idempotencyKey: input.idempotencyKey,
    })

    const definition = this.registry.get(input.type)
    const payload = definition.payloadSchema.parse(input.payload)
    // Enforce the action contract on the durable boundary, not just by convention.
    const rawAction = definition.action?.(payload) ?? null
    const action = rawAction ? notificationActionSchema.parse(rawAction) : null
    // Fingerprint the immutable dedupe intent: type/version/payload plus org + the
    // EXPLICIT occurredAt (never the generated default — a retry that omits it must
    // still match). Reusing a key with a different org/payload/event time is a conflict.
    const fingerprint = notificationFingerprint({
      type: input.type,
      category: definition.category,
      schemaVersion: definition.schemaVersion,
      payload,
      action,
      organizationId: input.organizationId ?? null,
      occurredAt: input.occurredAt?.toISOString() ?? null,
    })

    const [masterEnabled, userPreferences, user] = await Promise.all([
      this.preferences.getMasterToggle(input.recipientUserId, client),
      this.preferences.findByUser(input.recipientUserId, client),
      client.user.findUnique({
        where: { id: input.recipientUserId },
        select: { locale: true },
      }),
    ])

    const channels = this.resolver.resolve(definition, { masterEnabled, userPreferences })
    return {
      definition,
      payload,
      fingerprint,
      action,
      channels,
      locale: user?.locale ?? DEFAULT_LOCALE,
    }
  }

  private async write(
    client: Prisma.TransactionClient,
    input: NotifyInput,
    plan: NotifyPlan
  ): Promise<NotifyResult> {
    // Atomic "insert if absent" — createManyAndReturn + skipDuplicates is ON CONFLICT
    // DO NOTHING RETURNING, so a conflict does not raise (which would abort the
    // caller's transaction in notifyTx).
    const [created] = await client.notification.createManyAndReturn({
      data: [
        {
          recipientUserId: input.recipientUserId,
          organizationId: input.organizationId ?? null,
          type: plan.definition.type,
          category: plan.definition.category,
          schemaVersion: plan.definition.schemaVersion,
          payload: plan.payload as Prisma.InputJsonValue,
          ...(plan.action ? { action: plan.action as Prisma.InputJsonValue } : {}),
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: plan.fingerprint,
          occurredAt: input.occurredAt ?? new Date(),
        },
      ],
      skipDuplicates: true,
    })

    if (!created) {
      // Conflict: a matching fingerprint is a safe replay; a different one is reuse.
      const existing = await client.notification.findUniqueOrThrow({
        where: {
          recipientUserId_idempotencyKey: {
            recipientUserId: input.recipientUserId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      })
      if (existing.idempotencyFingerprint !== plan.fingerprint) {
        throw new NotificationIdempotencyConflictError(input.idempotencyKey)
      }
      // Replay: report the channels actually persisted then, not a fresh resolution.
      return {
        notificationId: existing.id,
        created: false,
        channels: await this.deliveredChannels(client, existing.id),
      }
    }

    // Arc A materializes only the in-app channel; report what was actually persisted.
    const channels: NotificationChannel[] = []
    if (plan.channels.includes(NotificationChannel.IN_APP)) {
      await client.notificationDelivery.create({
        data: {
          notificationId: created.id,
          channel: NotificationChannel.IN_APP,
          targetKey: 'feed',
          locale: plan.locale,
          status: NotificationDeliveryStatus.DELIVERED,
          maxAttempts: 1,
          deliveredAt: new Date(),
        },
      })
      channels.push(NotificationChannel.IN_APP)
    }

    return { notificationId: created.id, created: true, channels }
  }

  private async deliveredChannels(
    client: Prisma.TransactionClient,
    notificationId: string
  ): Promise<NotificationChannel[]> {
    const rows = await client.notificationDelivery.findMany({
      where: { notificationId },
      select: { channel: true },
    })
    return rows.map((row) => row.channel as NotificationChannel)
  }
}
