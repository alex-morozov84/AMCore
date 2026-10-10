import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { Queue } from 'bullmq'

import type { RequestPrincipal, WorkCommand, WorkReceipt, WorkReconciliation } from '@amcore/shared'

import { BackgroundCommandService, type BrokerCommandPort } from './background-command-service'
import { backgroundControlError } from './background-control-error'
import { ordinaryJobCommandPort } from './background-job-command'
import { queueCommandPort } from './background-queue-command'

import { ControlConnection } from '@/infrastructure/background-work/control-connection'
import type { DurableWorkControl } from '@/infrastructure/background-work/durable-work'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'
import { PROVIDER_WINDOW_CLOCK } from '@/infrastructure/background-work/provider-window-clock'
import { WORK_REGISTRATIONS } from '@/infrastructure/background-work/registration'
import type { WorkRegistration } from '@/infrastructure/background-work/work-definition'
import type { EmailProvider } from '@/infrastructure/email/email.types'
import { QUEUE_REGISTRY } from '@/infrastructure/queue/constants/queue-inventory.constant'

/** HTTP-neutral application entry: registration chooses every backend control owner. */
@Injectable()
export class BackgroundWorkService {
  constructor(
    @Inject(WORK_REGISTRATIONS) private readonly entries: readonly WorkRegistration[],
    @Inject(QUEUE_REGISTRY) private readonly queues: ReadonlyMap<string, Queue>,
    private readonly modules: ModuleRef,
    private readonly connection: ControlConnection,
    private readonly commands: BackgroundCommandService
  ) {}

  execute(principal: RequestPrincipal, input: WorkCommand): Promise<WorkReceipt> {
    const definition = this.entries.find(
      (entry) => entry.definition.id === input.workId
    )?.definition
    if (definition?.kind === 'durable') {
      const adapter = this.modules.get<DurableWorkControl>(definition.tokens.control, {
        strict: false,
      })
      return this.commands.executeDurable(principal, input, definition.definitionVersion, adapter)
    }
    let selected: BrokerCommandPort | undefined
    const port: BrokerCommandPort = {
      observe: async () => {
        if (!definition?.queue?.enabled) throw backgroundControlError('WORK_UNAVAILABLE')
        if (definition.kind !== 'ordinary') throw backgroundControlError('ACTION_UNAVAILABLE')
        const queue = this.queues.get(definition.queue.name)
        if (!queue) throw backgroundControlError('WORK_UNAVAILABLE')
        const queueAction = input.operation === 'pause' || input.operation === 'resume'
        selected = queueAction
          ? queueCommandPort(this.connection, queue.toKey(''), input)
          : ordinaryJobCommandPort(
              this.connection,
              queue,
              definition,
              input,
              Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window')
                ? {
                    evidence: this.modules.get(ProviderEvidenceStore, { strict: false }),
                    scope: () => {
                      const email = this.modules.get<EmailProvider>('EmailProvider', {
                        strict: false,
                      })
                      if (!email.queuedEmail) throw backgroundControlError('ACTION_UNAVAILABLE')
                      return email.queuedEmail.scope()
                    },
                  }
                : undefined
            )
        return selected.observe()
      },
      dispatch: (target) => {
        if (!selected) throw new Error('MISSING_DISPATCH_OWNER')
        return selected.dispatch(target)
      },
    }
    if (
      definition &&
      !['pause', 'resume'].includes(input.operation) &&
      Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window')
    )
      port.reserve = (ctx, targets) => {
        if (!selected?.reserve) throw new Error('MISSING_POLICY_RESERVATION')
        return selected.reserve(ctx, targets)
      }
    // Availability denials occur after committed request cost; receipt replays never require Redis.
    return this.commands.execute(principal, input, definition?.definitionVersion ?? 1, port)
  }

  receipt(principal: RequestPrincipal, commandId: string): Promise<WorkReceipt> {
    return this.commands.receipt(principal, commandId)
  }

  reconcile(
    principal: RequestPrincipal,
    commandId: string,
    input: WorkReconciliation
  ): Promise<WorkReceipt> {
    return this.commands.reconcile(
      principal,
      commandId,
      input,
      async (workId, deadline, pgTime, startedAt) => {
        const definition = this.entries.find((entry) => entry.definition.id === workId)?.definition
        if (!definition) throw backgroundControlError('WORK_UNAVAILABLE')
        if (definition.kind === 'durable') return // Its business/receipt/audit commit is primary-PG atomic.
        if (definition.kind !== 'ordinary' || !definition.queue?.enabled)
          throw backgroundControlError('ACTION_UNAVAILABLE')
        const wallStart = Date.now()
        const monoStart = performance.now()
        await this.connection.withClient(async (client) => {
          const time = await client.time()
          if ((await client.ping()) !== 'PONG') throw backgroundControlError('CLOCK_UNCERTAIN')
          const elapsed = Math.ceil(performance.now() - startedAt)
          const wallElapsed = Date.now() - wallStart
          const monoElapsed = performance.now() - monoStart
          const redisTime = Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000)
          const uncertainty = 2 * PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs
          if (
            !Number.isSafeInteger(redisTime) ||
            !Number.isSafeInteger(deadline) ||
            elapsed > PROVIDER_WINDOW_CLOCK.maxPgSampleAgeMs ||
            wallElapsed < 0 ||
            Math.abs(wallElapsed - monoElapsed) >
              PROVIDER_WINDOW_CLOCK.maxDualClockDisagreementMs ||
            Math.abs(redisTime - pgTime) > uncertainty + elapsed ||
            redisTime <= deadline + uncertainty
          )
            throw backgroundControlError('CLOCK_UNCERTAIN')
        })
      }
    )
  }

  reconcileEvidence(
    principal: RequestPrincipal,
    workId: string,
    jobId: string,
    input: WorkReconciliation
  ): Promise<void> {
    const definition = this.entries.find((entry) => entry.definition.id === workId)?.definition
    const supported =
      definition?.kind === 'ordinary' &&
      Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window')
    return this.commands.reconcileEvidence(
      principal,
      workId,
      jobId,
      input,
      supported ? this.modules.get(ProviderEvidenceStore, { strict: false }) : undefined
    )
  }
}
