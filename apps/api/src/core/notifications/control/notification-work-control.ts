import { HttpStatus, Injectable } from '@nestjs/common'

import type { WorkCommand, WorkReason } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { type NotificationDelivery, Prisma } from '../../../generated/prisma/client.js'
import type {
  DurableControlState,
  DurableOutcome,
  DurableTransactionContext,
  DurableWorkControl,
} from '../../../infrastructure/background-work/index.js'
import { NotificationControlTargets } from '../channels/notification-control-targets.js'

import {
  deliveryCapability,
  deliveryRevision,
  deliveryState,
  NOTIFICATION_CONTROL_RETENTION_MS,
  notificationWorkDigest,
} from './notification-control-policy.js'

interface BusinessState {
  gate?: { paused: boolean; revision: number }
  rows: NotificationDelivery[]
  refusals: Map<string, WorkReason>
}

@Injectable()
export class NotificationWorkControl implements DurableWorkControl {
  constructor(private readonly targets: NotificationControlTargets) {}

  async lock(ctx: DurableTransactionContext, command: WorkCommand): Promise<DurableControlState> {
    await ctx.tx.$queryRaw`SELECT set_config('lock_timeout', '500ms', true)`
    if (['pause', 'resume'].includes(command.operation)) {
      const [gate] = await ctx.tx.$queryRaw<{ paused: boolean; revision: number }[]>`
        SELECT paused, revision FROM notifications.notification_delivery_control WHERE id = 1 FOR UPDATE`
      if (!gate) throw new Error('notification_claim_authority_missing')
      return {
        targets: [
          {
            id: command.workId,
            snapshot: { revision: notificationWorkDigest([gate.paused, gate.revision]) },
          },
        ],
        businessState: { gate, rows: [], refusals: new Map() } satisfies BusinessState,
      }
    }
    const ids = command.targets.map((target) => target.id).sort()
    const initial = await ctx.tx.notificationDelivery.findMany({
      where: { id: { in: ids } },
      include: { notification: true },
    })
    const refusals = new Map<string, WorkReason>()
    if (command.operation === 'retry') {
      for (const row of [...initial].sort((a, b) =>
        `${a.channel}:${a.targetRef ?? a.targetKey}`.localeCompare(
          `${b.channel}:${b.targetRef ?? b.targetKey}`
        )
      )) {
        const reason = await this.retryCompatibility(ctx, row, row.notification)
        if (reason) refusals.set(row.id, reason)
      }
    }
    const parentIds = [...new Set(initial.map((row) => row.notificationId))].sort()
    if (parentIds.length)
      await ctx.tx.$queryRaw(Prisma.sql`
      SELECT id FROM notifications.notifications WHERE id IN (${Prisma.join(parentIds)}) ORDER BY id
      ${command.operation === 'cleanup' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`)
    let lockIds = ids
    if (command.operation === 'cleanup' && parentIds.length) {
      const siblings = await ctx.tx.notificationDelivery.findMany({
        where: { notificationId: { in: parentIds } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 4097,
      })
      if (siblings.length > 4096)
        throw new AppException('Notification cleanup read limit', HttpStatus.CONFLICT, 'READ_LIMIT')
      lockIds = siblings.map((row) => row.id)
    }
    const locked = lockIds.length
      ? await ctx.tx.$queryRaw<NotificationDelivery[]>(Prisma.sql`
      SELECT * FROM notifications.notification_deliveries WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`)
      : []
    const rows = locked.filter((row) => ids.includes(row.id))
    const [clock] = await ctx.tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    ctx.now = clock!.now
    return {
      targets: command.targets.map((target) => {
        const row = rows.find((item) => item.id === target.id)
        return {
          id: target.id,
          incarnation: row?.incarnation ?? target.incarnation,
          snapshot: { revision: row ? deliveryRevision(row) : target.revision },
        }
      }),
      businessState: { rows, refusals } satisfies BusinessState,
    }
  }

  eligibility(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): WorkReason | null {
    const state = locked.businessState as BusinessState
    if (state.gate) {
      if (
        notificationWorkDigest([state.gate.paused, state.gate.revision]) !==
        command.expectedWorkRevision
      )
        return 'STATE_CHANGED'
      return state.gate.paused === (command.operation === 'pause') ? 'ALREADY_IN_STATE' : null
    }
    const target = command.targets[0]
    const row = state.rows.find((item) => item.id === target?.id)
    if (!row) return 'HISTORY_EXPIRED'
    if (row.incarnation !== target?.incarnation || deliveryRevision(row) !== target.revision)
      return 'STATE_CHANGED'
    return state.refusals.get(row.id) ?? deliveryCapability(row, command.operation, ctx.now)
  }

  async apply(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): Promise<ReadonlyMap<string, DurableOutcome>> {
    const state = locked.businessState as BusinessState
    const id = locked.targets[0]!.id
    const [clock] = await ctx.tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    ctx.now = clock!.now
    const reason = this.eligibility(ctx, locked, command)
    if (reason) return new Map([[id, { state: 'rejected', reason }]])
    if (state.gate) {
      await ctx.tx.notificationDeliveryControl.update({
        where: { id: 1 },
        data: { paused: command.operation === 'pause', revision: { increment: 1 } },
      })
    } else {
      const row = state.rows[0]!
      if (command.operation === 'retry')
        await ctx.tx.notificationDelivery.update({
          where: { id },
          data: {
            manualGrant: 'reserved',
            grantActorId: ctx.principal.sub,
            grantCommandId: ctx.commandId,
            status: 'RETRY_SCHEDULED',
            terminalAt: null,
            failedAt: null,
            lastErrorCode: null,
            retryableExhaustion: false,
            nextAttemptAt: new Date(
              Math.max(
                clock!.now.getTime(),
                row.availableAt.getTime(),
                row.nextAttemptAt?.getTime() ?? 0
              )
            ),
            controlRevision: { increment: 1 },
          },
        })
      else if (command.operation === 'cancel')
        await ctx.tx.notificationDelivery.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            terminalReasonCode: 'operator_cancelled',
            terminalAt: clock!.now,
            manualGrant: row.manualGrant === 'reserved' ? 'spent' : row.manualGrant,
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            controlRevision: { increment: 1 },
          },
        })
      else {
        const cutoff = new Date(command.parameters.cutoff!)
        if (
          !row.terminalAt ||
          row.terminalAt > cutoff ||
          cutoff.getTime() > clock!.now.getTime() - NOTIFICATION_CONTROL_RETENTION_MS ||
          !command.parameters.states?.includes(deliveryState(row) as 'completed' | 'failed') ||
          (await ctx.tx.notificationDeliveryAttempt.count({
            where: { deliveryId: id, outcome: null },
          }))
        )
          return new Map([[id, { state: 'rejected', reason: 'STATE_CHANGED' }]])
        await ctx.tx.notificationDelivery.delete({ where: { id } })
      }
    }
    return new Map([[id, { state: 'applied' }]])
  }

  private async retryCompatibility(
    ctx: DurableTransactionContext,
    row: NotificationDelivery,
    notification: Prisma.NotificationGetPayload<object>
  ): Promise<WorkReason | null> {
    const reason = deliveryCapability(row, 'retry')
    if (reason) return reason
    return this.targets.validate(ctx.tx, row, notification)
  }
}
