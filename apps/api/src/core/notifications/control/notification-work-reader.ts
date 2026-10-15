import { Injectable } from '@nestjs/common'

import {
  WORK_OPERATIONS,
  type WorkJob,
  workJobSchema,
  type WorkListQuery,
  workListRowSchema,
  type WorkPage,
  type WorkSummary,
  workSummarySchema,
} from '@amcore/shared'

import { BadRequestException } from '../../../common/exceptions/index.js'
import { redactEmail } from '../../../common/utils/index.js'
import { type NotificationDelivery, Prisma } from '../../../generated/prisma/client.js'
import { resolveWorkFailure } from '../../../infrastructure/background-work/work-failure.js'
import { PrismaService } from '../../../prisma/index.js'
import { NotificationChannelRegistry } from '../channels/notification-channel.registry.js'
import { NotificationControlTargets } from '../channels/notification-control-targets.js'

import {
  deliveryCapability,
  deliveryRevision,
  deliveryState,
  notificationWorkDigest,
} from './notification-control-policy.js'
import { notificationControlProjection } from './notification-control-projection.js'
import { notificationDeliveriesWork } from './notification-deliveries.work.js'
import { notificationWorkFailures } from './notification-work-failures.js'

const states: Record<string, string[]> = {
  waiting: ['PENDING'],
  active: ['PROCESSING'],
  delayed: ['RETRY_SCHEDULED'],
  failed: ['FAILED'],
  completed: ['DELIVERED', 'SKIPPED', 'CANCELLED'],
  prioritized: [],
}

@Injectable()
export class NotificationWorkReader {
  constructor(
    private readonly db: PrismaService,
    private readonly channels: NotificationChannelRegistry,
    private readonly targets: NotificationControlTargets
  ) {}

  async readSummary(): Promise<WorkSummary> {
    return this.read(async (tx) => {
      const [gate] = await tx.$queryRaw<{ paused: boolean; revision: number; now: Date }[]>`
        SELECT paused, revision, clock_timestamp() AS now FROM notifications.notification_delivery_control WHERE id = 1`
      if (!gate) throw new Error('notification_claim_authority_missing')
      const predicates: Record<string, Prisma.Sql> = {
        pending: Prisma.sql`status IN ('PENDING', 'RETRY_SCHEDULED')`,
        due: Prisma.sql`status IN ('PENDING', 'RETRY_SCHEDULED') AND "availableAt" <= ${gate.now}
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${gate.now})`,
        processing: Prisma.sql`status = 'PROCESSING'`,
        failed: Prisma.sql`status = 'FAILED'`,
        terminal: Prisma.sql`status IN ('DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED')`,
        unresolved: Prisma.sql`"unresolvedEffectCount" > 0 OR "legacyUnverified"`,
      }
      const queries = Object.entries(predicates).map(
        ([key, predicate]) => Prisma.sql`
        SELECT ${key}::text AS key, count(*)::int AS value FROM (
          SELECT id FROM notifications.notification_deliveries WHERE ${predicate} LIMIT 10001
        ) AS bounded`
      )
      const counts = await tx.$queryRaw<{ key: string; value: number }[]>(
        Prisma.join(queries, ' UNION ALL ')
      )
      return workSummarySchema.parse({
        id: notificationDeliveriesWork.id,
        kind: 'durable',
        definitionVersion: 1,
        status: 'available',
        sampledAt: gate.now.toISOString(),
        paused: gate.paused,
        revision: notificationWorkDigest([gate.paused, gate.revision]),
        counts: Object.fromEntries(
          counts.map((row) => [
            row.key,
            { value: Math.min(row.value, 10000), truncated: row.value > 10000 },
          ])
        ),
        presentation: {
          ...notificationDeliveriesWork.presentation!,
          filters: [
            {
              key: 'channel',
              label: { en: 'Channel', ru: 'Канал' },
              options: this.channels
                .ids()
                .map((value) => ({ value, label: { en: value, ru: value } })),
            },
          ],
        },
        capabilities: WORK_OPERATIONS.map((operation) => ({
          operation,
          allowed:
            operation === 'pause' ? !gate.paused : operation === 'resume' ? gate.paused : true,
        })),
      })
    })
  }

  async list(query: WorkListQuery): Promise<WorkPage> {
    const filters = query.filters ?? {}
    if (
      Object.keys(filters).some((key) => key !== 'channel') ||
      (filters.channel !== undefined && !this.channels.ids().includes(filters.channel))
    )
      throw new BadRequestException('Invalid notification work filter')
    const offset = (query.page - 1) * query.limit
    const limit = Math.max(0, Math.min(query.limit, 512 - offset))
    return this.read(async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      if (!states[query.state]?.length) return this.page([], false, clock!.now)
      const predicate = Prisma.sql`status::text IN (${Prisma.join(states[query.state]!, ', ')})`
      const observed = await tx.$queryRaw<
        ((NotificationDelivery | { id: null }) & { windowTruncated: boolean })[]
      >(Prisma.sql`
        WITH bounded AS MATERIALIZED (
          SELECT ${notificationControlProjection} FROM notifications.notification_deliveries WHERE ${predicate}
          ${filters.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
          ORDER BY "createdAt" DESC, id DESC LIMIT 513
        ), visible AS (SELECT * FROM bounded ORDER BY "createdAt" DESC, id DESC LIMIT 512),
        paged AS (SELECT * FROM visible
        ${query.search ? Prisma.sql`WHERE strpos(lower(id), lower(${query.search})) > 0` : Prisma.empty}
        ORDER BY "createdAt" DESC, id DESC LIMIT ${limit} OFFSET ${offset})
        SELECT paged.*, witness.truncated AS "windowTruncated"
        FROM (SELECT count(*) > 512 AS truncated FROM bounded) witness
        LEFT JOIN paged ON true ORDER BY paged."createdAt" DESC, paged.id DESC`)
      const rows = observed.filter(
        (row): row is NotificationDelivery & { windowTruncated: boolean } => row.id !== null
      )
      const retries = rows.filter((row) => deliveryCapability(row, 'retry', clock!.now) === null)
      const retained = retries.length
        ? await tx.notificationDelivery.findMany({
            where: { id: { in: retries.map((row) => row.id) } },
            include: { notification: true },
            take: 50,
          })
        : []
      const compatibility = new Map<string, import('@amcore/shared').WorkReason | null>()
      for (const row of retained.sort((a, b) =>
        `${a.channel}:${a.targetRef ?? a.targetKey}`.localeCompare(
          `${b.channel}:${b.targetRef ?? b.targetKey}`
        )
      ))
        compatibility.set(row.id, await this.targets.validate(tx, row, row.notification))
      return this.page(
        rows.map((row) =>
          workListRowSchema.parse(this.project(row, clock!.now, compatibility.get(row.id)))
        ),
        observed[0]?.windowTruncated,
        clock!.now
      )
    })
  }

  async detail(id: string): Promise<WorkJob | null> {
    return this.read(async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      const row = await tx.notificationDelivery.findUnique({ where: { id } })
      if (!row) return null
      const oldest = await tx.notificationDeliveryAttempt.findFirst({
        where: { deliveryId: id },
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true },
      })
      const attempts = await tx.notificationDeliveryAttempt.findMany({
        where: { deliveryId: id },
        orderBy: { attemptNumber: 'desc' },
        take: 17,
      })
      return workJobSchema.parse({
        ...this.project(
          row,
          clock!.now,
          deliveryCapability(row, 'retry', clock!.now) === null
            ? await this.targets.validate(
                tx,
                row,
                await tx.notification.findUniqueOrThrow({ where: { id: row.notificationId } })
              )
            : undefined
        ),
        history: {
          attempts: attempts.slice(0, 16).map((attempt) => ({
            number: attempt.attemptNumber,
            startedAt: attempt.startedAt.toISOString(),
            ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt.toISOString() } : {}),
            outcome: attempt.outcome?.toLowerCase() ?? 'active',
            certainty:
              attempt.effectState === 'accepted'
                ? 'accepted'
                : ['possible', 'unknown'].includes(attempt.effectState)
                  ? 'unknown'
                  : 'none',
            ...(attempt.errorCode && Object.hasOwn(notificationWorkFailures, attempt.errorCode)
              ? { reason: attempt.errorCode }
              : {}),
            ...(attempt.grantActorId ? { actorId: attempt.grantActorId } : {}),
            ...(attempt.grantCommandId ? { commandId: attempt.grantCommandId } : {}),
          })),
          historyTruncated: attempts.length > 16,
          historyExpired: row.historyPrunedThrough > 0,
          ...(oldest ? { oldestRetainedNumber: oldest.attemptNumber } : {}),
        },
      })
    })
  }

  private project(
    row: NotificationDelivery,
    now: Date,
    compatibility?: import('@amcore/shared').WorkReason | null
  ): WorkJob {
    return {
      identity: { id: row.id, incarnation: row.incarnation, revision: deliveryRevision(row) },
      ...(row.status === 'FAILED' &&
      resolveWorkFailure(notificationDeliveriesWork, row.lastErrorCode)
        ? { failure: resolveWorkFailure(notificationDeliveriesWork, row.lastErrorCode) }
        : {}),
      state: deliveryState(row),
      nativeState: row.status,
      jobName: 'notification-delivery',
      wireVersion: 1,
      sampledAt: now.toISOString(),
      source: 'domain',
      replay: 'durable',
      attemptsStarted: row.attemptCount,
      attemptsMade: row.attemptCount,
      manualGrant: row.manualGrant as WorkJob['manualGrant'],
      certainty: row.acceptedSeen
        ? 'accepted'
        : row.unresolvedEffectCount || row.legacyUnverified
          ? 'unknown'
          : 'none',
      ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt.toISOString() } : {}),
      projection: {
        channel: row.channel,
        reference: row.notificationId,
        ...(row.channel === 'telegram' && row.targetRef ? { generation: row.targetRef } : {}),
        unresolved: !!(row.unresolvedEffectCount || row.legacyUnverified),
        target:
          row.channel === 'email'
            ? redactEmail(row.targetKey)
            : row.channel === 'telegram'
              ? `***${row.targetKey.slice(-4)}`
              : '—',
      },
      capabilities: WORK_OPERATIONS.map((operation) => {
        const reason =
          operation === 'retry' && !this.channels.ids().includes(row.channel)
            ? 'ACTION_UNAVAILABLE'
            : operation === 'retry' && compatibility
              ? compatibility
              : deliveryCapability(row, operation, now)
        return { operation, allowed: reason === null, ...(reason ? { reason } : {}) }
      }),
    }
  }

  private page(rows: WorkJob[], windowTruncated: boolean | undefined, now: Date): WorkPage {
    return {
      workId: notificationDeliveriesWork.id,
      sampledAt: now.toISOString(),
      rows,
      windowTruncated: windowTruncated ?? false,
    }
  }

  private read<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '2000ms', true), set_config('lock_timeout', '500ms', true)`
        return run(tx)
      },
      { timeout: 5000 }
    )
  }
}
