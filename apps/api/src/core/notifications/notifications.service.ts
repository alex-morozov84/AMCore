import { Injectable } from '@nestjs/common'
import { NotificationDeliveryStatus, type Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import { type NotificationAction, notificationActionSchema } from '@amcore/shared'

import { PrismaService } from '../../prisma'

import { ChannelTargetResolverRegistry } from './channels/channel-target-resolver.registry'
import type { TargetRecipient } from './channels/channel-target-resolver.types'
import { NotificationChannel } from './notification.constants'
import { NotificationIdempotencyConflictError } from './notification.errors'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinition } from './notification-definition.types'
import {
  NOTIFICATION_EXTERNAL_MAX_ATTEMPTS,
  NOTIFICATION_IN_APP_MAX_ATTEMPTS,
  NOTIFICATION_WAKE_JOB_OPTIONS,
} from './notification-dispatch.constants'
import type { DispatchDueJob } from './notification-dispatch.schema'
import { notificationFingerprint } from './notification-fingerprint'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'
import { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher'

import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'

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
  recipient: TargetRecipient | null
}

/**
 * Internal result of a single produce run. `hasPendingExternal` tells `notify()`
 * whether a best-effort dispatch wake is worth enqueuing (a fresh `PENDING` external
 * delivery exists); it is never true on an idempotent replay — the poller recovers
 * any pre-existing pending work.
 */
interface InternalNotifyResult {
  result: NotifyResult
  hasPendingExternal: boolean
}

const DEFAULT_LOCALE = 'ru'

/**
 * Canonical channel order (the `NotificationChannel` enum declaration order) applied to
 * every returned channel list, so the created-path result and an idempotent-replay
 * result (queried from the DB in any order) report the same deterministic sequence.
 */
const CHANNEL_ORDER: readonly NotificationChannel[] = Object.values(NotificationChannel)
function sortByChannelOrder(channels: NotificationChannel[]): NotificationChannel[] {
  return [...channels].sort((a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b))
}

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
    private readonly preferences: NotificationPreferenceRepository,
    private readonly targetResolvers: ChannelTargetResolverRegistry,
    private readonly queue: QueueService,
    private readonly realtime: NotificationRealtimePublisher,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationsService.name)
  }

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const { result, hasPendingExternal } = await this.prisma.$transaction((tx) =>
      this.run(tx, input)
    )
    // Best-effort realtime feed hint (ADR-053), fired independently of the wake and
    // never awaited: only when a NEW in-app delivery was created (an external-only
    // notification does not touch the feed; a replay re-hints nothing). The client
    // repairs any missed hint on its next refetch.
    if (result.created && result.channels.includes(NotificationChannel.IN_APP)) {
      void this.realtime.publish(input.recipientUserId, 'created', result.notificationId)
    }
    // Wake the dispatcher only AFTER commit, and only for fresh external work.
    // Best-effort: a Redis/queue outage here must not fail a committed notification —
    // the worker recovery poller discovers the PENDING delivery regardless (ADR-052).
    if (hasPendingExternal) await this.enqueueWake(result.notificationId)
    return result
  }

  async notifyTx(tx: Prisma.TransactionClient, input: NotifyInput): Promise<NotifyResult> {
    // No wake here: the caller owns commit timing, so we cannot know when the rows
    // become visible. The recovery poller discovers committed external deliveries
    // (bounded latency) — the deliberate trade-off for transactional atomicity.
    const { result } = await this.run(tx, input)
    return result
  }

  // Build + write on the SAME client so resolution reads and the inserts share one
  // transactional snapshot (critical for notifyTx — the caller's transaction).
  private async run(
    client: Prisma.TransactionClient,
    input: NotifyInput
  ): Promise<InternalNotifyResult> {
    const plan = await this.buildPlan(client, input)
    return this.write(client, input, plan)
  }

  /** Best-effort dispatch wake. Swallows queue/Redis errors (the poller recovers). */
  private async enqueueWake(notificationId: string): Promise<void> {
    try {
      await this.queue.add(
        QueueName.NOTIFICATIONS,
        JobName.DISPATCH_DUE,
        { notificationId } satisfies DispatchDueJob,
        NOTIFICATION_WAKE_JOB_OPTIONS
      )
    } catch (err) {
      this.logger.warn(
        {
          event: 'notification.wake_enqueue_failed',
          notificationId,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Failed to enqueue notification dispatch wake (recovery poller will drain)'
      )
    }
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
        // email/emailVerified feed external target resolution (e.g. email channel).
        select: { locale: true, email: true, emailCanonical: true, emailVerified: true },
      }),
    ])

    const channels = this.resolver.resolve(definition, { masterEnabled, userPreferences })
    const locale = user?.locale ?? DEFAULT_LOCALE
    return {
      definition,
      payload,
      fingerprint,
      action,
      channels,
      locale,
      recipient: user
        ? {
            id: input.recipientUserId,
            email: user.email,
            emailCanonical: user.emailCanonical,
            emailVerified: user.emailVerified,
            locale,
          }
        : null,
    }
  }

  private async write(
    client: Prisma.TransactionClient,
    input: NotifyInput,
    plan: NotifyPlan
  ): Promise<InternalNotifyResult> {
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
      // No wake — the original produce already enqueued one, and the poller recovers
      // any still-pending external delivery regardless.
      return {
        result: {
          notificationId: existing.id,
          created: false,
          channels: await this.deliveredChannels(client, existing.id),
        },
        hasPendingExternal: false,
      }
    }

    // Materialize deliveries: in-app inserted DELIVERED (feed never depends on the
    // worker); each enabled external channel resolves its targets to PENDING rows the
    // dispatcher drains, or SKIPPED rows for an absent/unusable destination (observable
    // terminal state, never retried).
    const deliveries: Prisma.NotificationDeliveryCreateManyInput[] = []
    const persisted = new Set<NotificationChannel>()
    let hasPendingExternal = false

    if (plan.channels.includes(NotificationChannel.IN_APP)) {
      deliveries.push({
        notificationId: created.id,
        channel: NotificationChannel.IN_APP,
        targetKey: 'feed',
        locale: plan.locale,
        status: NotificationDeliveryStatus.DELIVERED,
        maxAttempts: NOTIFICATION_IN_APP_MAX_ATTEMPTS,
        deliveredAt: new Date(),
      })
      persisted.add(NotificationChannel.IN_APP)
    }

    for (const channel of plan.channels) {
      if (channel === NotificationChannel.IN_APP) continue
      const targetResolver = this.targetResolvers.get(channel)
      // No active adapter (or no recipient facts) → nothing is persisted for this
      // channel; it cannot be delivered and must not advertise a phantom delivery.
      if (!targetResolver || !plan.recipient) continue

      const targets = targetResolver.resolveTargets({
        recipient: plan.recipient,
        definition: plan.definition,
        payload: plan.payload,
        locale: plan.locale,
      })

      for (const target of targets) {
        const skipped = target.skipReasonCode !== undefined
        deliveries.push({
          notificationId: created.id,
          channel,
          targetKey: target.targetKey,
          targetRef: target.targetRef ?? null,
          ...(target.destinationSnapshot !== undefined
            ? { destinationSnapshot: target.destinationSnapshot }
            : {}),
          locale: plan.locale,
          status: skipped ? NotificationDeliveryStatus.SKIPPED : NotificationDeliveryStatus.PENDING,
          maxAttempts: NOTIFICATION_EXTERNAL_MAX_ATTEMPTS,
          // SKIPPED is a terminal non-failure: record the reason, but no failedAt.
          ...(skipped ? { terminalReasonCode: target.skipReasonCode } : {}),
        })
        if (!skipped) hasPendingExternal = true
        persisted.add(channel)
      }
    }

    if (deliveries.length > 0) {
      await client.notificationDelivery.createMany({ data: deliveries })
    }

    return {
      result: {
        notificationId: created.id,
        created: true,
        channels: sortByChannelOrder(plan.channels.filter((channel) => persisted.has(channel))),
      },
      hasPendingExternal,
    }
  }

  private async deliveredChannels(
    client: Prisma.TransactionClient,
    notificationId: string
  ): Promise<NotificationChannel[]> {
    // Deterministic order once a notification has >1 delivery (A.5 carry-forward) AND
    // identical to the created-path order, so a replay reports the same sequence.
    const rows = await client.notificationDelivery.findMany({
      where: { notificationId },
      select: { channel: true },
      distinct: ['channel'],
    })
    return sortByChannelOrder(rows.map((row) => row.channel as NotificationChannel))
  }
}
