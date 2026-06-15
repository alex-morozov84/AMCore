import { Injectable } from '@nestjs/common'
import { NotificationDeliveryStatus, type Prisma } from '@prisma/client'

import type { NotificationAction } from '@amcore/shared'

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
    const plan = await this.buildPlan(input)
    return this.prisma.$transaction((tx) => this.write(tx, input, plan))
  }

  async notifyTx(tx: Prisma.TransactionClient, input: NotifyInput): Promise<NotifyResult> {
    const plan = await this.buildPlan(input)
    return this.write(tx, input, plan)
  }

  private async buildPlan(input: NotifyInput): Promise<NotifyPlan> {
    const definition = this.registry.get(input.type)
    const payload = definition.payloadSchema.parse(input.payload)
    const action = definition.action?.(payload) ?? null
    const fingerprint = notificationFingerprint(input.type, definition.schemaVersion, payload)

    const [masterEnabled, userPreferences, user] = await Promise.all([
      this.preferences.getMasterToggle(input.recipientUserId),
      this.preferences.findByUser(input.recipientUserId),
      this.prisma.user.findUnique({
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
      return { notificationId: existing.id, created: false, channels: plan.channels }
    }

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
    }

    return { notificationId: created.id, created: true, channels: plan.channels }
  }
}
