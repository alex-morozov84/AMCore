import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { Queue } from 'bullmq'

import {
  type RequestPrincipal,
  WORK_OPERATIONS,
  workCatalogueSchema,
  type WorkSummary,
  workSummarySchema,
} from '@amcore/shared'

import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets } from './background-control-budgets'

import { AppException } from '@/common/exceptions'
import { ControlConnection } from '@/infrastructure/background-work/control-connection'
import { backgroundControlTransaction } from '@/infrastructure/background-work/control-transaction'
import type { DurableWorkReader } from '@/infrastructure/background-work/durable-work'
import { readQueueSnapshot } from '@/infrastructure/background-work/queue-snapshot'
import { WORK_REGISTRATIONS } from '@/infrastructure/background-work/registration'
import type {
  WorkDefinition,
  WorkRegistration,
} from '@/infrastructure/background-work/work-definition'
import { QUEUE_REGISTRY } from '@/infrastructure/queue/constants/queue-inventory.constant'
import { PrismaService } from '@/prisma'

/** Registration is the catalogue. Redis failure affects resource availability, never authorization. */
@Injectable()
export class BackgroundWorkCatalogue {
  constructor(
    @Inject(WORK_REGISTRATIONS) private readonly entries: readonly WorkRegistration[],
    @Inject(QUEUE_REGISTRY) private readonly queues: ReadonlyMap<string, Queue>,
    private readonly modules: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly connection: ControlConnection,
    private readonly authority: BackgroundControlAuthority,
    private readonly budgets: BackgroundControlBudgets
  ) {}

  async list(principal: RequestPrincipal): Promise<readonly WorkSummary[]> {
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, false)
      await this.budgets.request(ctx, rows, true)
    })
    const results: WorkSummary[] = []
    for (let offset = 0; offset < this.entries.length; offset += 4)
      results.push(
        ...(await Promise.all(
          this.entries.slice(offset, offset + 4).map(({ definition }) => this.summary(definition))
        ))
      )
    const catalogue = workCatalogueSchema.safeParse(results)
    if (!catalogue.success)
      throw new AppException(
        'Registration catalogue exceeds its encoded limit',
        503,
        'WORK_UNAVAILABLE'
      )
    return catalogue.data
  }

  private async summary(definition: WorkDefinition): Promise<WorkSummary> {
    const base = {
      id: definition.id,
      ...(definition.presentation ? { presentation: definition.presentation } : {}),
      kind: definition.kind,
      definitionVersion: definition.definitionVersion,
      providerEvidence: Object.values(definition.jobs).some(
        (job) => job.replay.kind === 'provider-window'
      ),
      sampledAt: new Date().toISOString(),
    }
    if (definition.queue && !definition.queue.enabled)
      return workSummarySchema.parse({
        ...base,
        status: 'disabled',
        capabilities: disabledCapabilities('WORK_UNAVAILABLE'),
      })
    try {
      if (definition.kind === 'durable') {
        const reader = this.modules.get<DurableWorkReader>(definition.tokens.reader, {
          strict: false,
        })
        const result = workSummarySchema.parse(await reader.readSummary())
        if (result.id !== definition.id || result.kind !== 'durable')
          throw new Error('INVALID_DOMAIN_SUMMARY')
        return workSummarySchema.parse({
          ...result,
          ...(definition.presentation ? { presentation: definition.presentation } : {}),
        })
      }
      const queue = definition.queue && this.queues.get(definition.queue.name)
      if (!queue) throw new Error('MISSING_QUEUE')
      const observed = await this.connection.withClient((client) =>
        readQueueSnapshot(client, queue.toKey(''))
      )
      if (observed.status !== 'observed') throw new Error('UNAVAILABLE_QUEUE')
      const snapshot = observed.snapshot
      return workSummarySchema.parse({
        ...base,
        status: 'available',
        sampledAt: new Date(snapshot.sampledAt).toISOString(),
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        paused: snapshot.paused,
        capabilities:
          definition.kind !== 'ordinary'
            ? disabledCapabilities('ACTION_UNAVAILABLE')
            : WORK_OPERATIONS.map((operation) => {
                const queueAction = operation === 'pause' || operation === 'resume'
                const supportedLayout = snapshot.layout !== 'legacy-mixed'
                const allowed =
                  queueAction &&
                  supportedLayout &&
                  (operation === 'pause' ? !snapshot.paused : snapshot.paused)
                return {
                  operation,
                  allowed,
                  ...(!allowed
                    ? {
                        reason: queueAction
                          ? supportedLayout
                            ? 'ALREADY_IN_STATE'
                            : 'LEGACY_MIGRATION_REQUIRED'
                          : 'ACTION_UNAVAILABLE',
                      }
                    : {}),
                }
              }),
      })
    } catch {
      return workSummarySchema.parse({
        ...base,
        status: 'unavailable',
        capabilities: disabledCapabilities('WORK_UNAVAILABLE'),
      })
    }
  }
}

function disabledCapabilities(
  reason: 'ACTION_UNAVAILABLE' | 'WORK_UNAVAILABLE'
): WorkSummary['capabilities'] {
  return WORK_OPERATIONS.map((operation) => ({ operation, allowed: false, reason }))
}
