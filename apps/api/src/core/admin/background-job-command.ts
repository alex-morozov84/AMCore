import type { Queue } from 'bullmq'
import { z } from 'zod'

import { type WorkCommand, workReasonSchema } from '@amcore/shared'

import type { CommandTargetSnapshot } from './background-command-admission'
import type { BrokerCommandPort } from './background-command-service'
import { backgroundControlError } from './background-control-error'

import { AppException } from '@/common/exceptions'
import { ControlConnection } from '@/infrastructure/background-work/control-connection'
import {
  providerTargetRevision,
  readJobSnapshot,
} from '@/infrastructure/background-work/job-snapshot'
import { parseManagedJob } from '@/infrastructure/background-work/managed-job-profile'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'
import { readQueueSnapshot } from '@/infrastructure/background-work/queue-snapshot'
import { applyIdempotentCommand } from '@/infrastructure/background-work/scripts/idempotent-command'
import { applyProviderWindowCommand } from '@/infrastructure/background-work/scripts/idempotent-command'
import { type WorkDefinition } from '@/infrastructure/background-work/work-definition'
import { WorkPolicyError } from '@/infrastructure/background-work/work-policy-error'

const witnessSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{40}$/),
  wireVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  state: z.string(),
  minimumAgeMs: z.number().int().positive(),
})

/** One ordinary dispatcher; provider-window adds its existing independent evidence authority. */
export function ordinaryJobCommandPort(
  connection: ControlConnection,
  queue: Queue,
  definition: WorkDefinition,
  input: WorkCommand,
  provider?: { evidence: ProviderEvidenceStore; scope(): string }
): BrokerCommandPort {
  if (!['retry', 'cancel', 'cleanup'].includes(input.operation))
    throw backgroundControlError('ACTION_UNAVAILABLE')
  return {
    observe: async () => {
      const deadline = performance.now() + 5000
      const observations = await connection.withClient(async (client) => {
        if (performance.now() >= deadline) throw backgroundControlError('READ_LIMIT')
        const queueState = await readQueueSnapshot(client, queue.toKey(''))
        if (queueState.status !== 'observed')
          throw backgroundControlError(workReasonSchema.parse(queueState.reason))
        if (queueState.snapshot.revision !== input.expectedWorkRevision)
          throw backgroundControlError('STATE_CHANGED')
        let remaining = 512 * 1024
        const observed: CommandTargetSnapshot[] = []
        for (const target of input.targets) {
          const reject = (reason: import('@amcore/shared').WorkReason): CommandTargetSnapshot => ({
            id: target.id,
            incarnation: target.incarnation,
            snapshot: {
              revision: target.revision,
              preflightReason: reason,
            },
          })
          if (remaining < 65536 || performance.now() >= deadline) {
            observed.push(reject('READ_LIMIT'))
            continue
          }
          const result = await readJobSnapshot(client, queue, target.id)
          if (result.status !== 'observed') {
            observed.push(reject(workReasonSchema.parse(result.reason)))
            continue
          }
          remaining -= result.snapshot.raw.bytes
          if (
            input.operation === 'cleanup' &&
            !input.parameters.states?.some((state) => state === result.snapshot.state)
          ) {
            observed.push(reject('STATE_CHANGED'))
            continue
          }
          try {
            const snapshot = jobCommandSnapshot(definition, target.id, result.snapshot)
            const matches =
              snapshot.incarnation === target.incarnation &&
              (snapshot.snapshot.replay === 'provider-window' ||
                result.snapshot.revision === target.revision)
            observed.push(
              matches
                ? {
                    ...snapshot,
                    snapshot: {
                      ...snapshot.snapshot,
                      revision: target.revision,
                      brokerRevision: result.snapshot.revision,
                    },
                  }
                : reject('STATE_CHANGED')
            )
          } catch (error) {
            if (!(error instanceof AppException)) throw error
            observed.push(reject(workReasonSchema.parse(error.errorCode)))
          }
        }
        return observed
      })
      // Independent PG evidence is read only AFTER releasing the broker lease.
      const results: CommandTargetSnapshot[] = []
      for (const target of observations) {
        const snapshot = { ...target.snapshot }
        results.push({ ...target, snapshot })
        if (snapshot.replay !== 'provider-window' || snapshot.preflightReason) continue
        if (!provider) {
          snapshot.preflightReason = 'ACTION_UNAVAILABLE'
          continue
        }
        const row = await provider.evidence.read(definition.id, target.incarnation!)
        snapshot.evidenceRevision = row?.revision ?? null
        if (
          providerTargetRevision(String(snapshot.brokerRevision), row?.revision ?? null) !==
          snapshot.revision
        )
          snapshot.preflightReason = 'STATE_CHANGED'
        if (!row && snapshot.evidenceInitialized) snapshot.preflightReason = 'OUTCOME_UNRECORDED'
        if (input.operation === 'retry' && row?.providerScope !== provider.scope())
          snapshot.preflightReason = 'PROVIDER_CHANGED'
      }
      return results
    },
    ...(provider
      ? ({
          reserve: async (ctx, observed) => {
            const results: CommandTargetSnapshot[] = []
            for (const target of observed) {
              const snapshot = { ...target.snapshot }
              results.push({ ...target, snapshot })
              if (snapshot.replay !== 'provider-window' || snapshot.preflightReason) continue
              try {
                const row = await provider.evidence.reserveControl(
                  ctx,
                  {
                    workId: definition.id,
                    jobId: target.id,
                    incarnation: target.incarnation!,
                    queueEpoch: target.queueEpoch!,
                    jobName: String(target.snapshot.jobName),
                    wireVersion: Number(target.snapshot.wireVersion),
                    policyVersion: Number(target.snapshot.policyVersion),
                    automaticLimit: Number(target.snapshot.automaticLimit),
                    evidenceRevision:
                      target.snapshot.evidenceRevision === null
                        ? null
                        : Number(target.snapshot.evidenceRevision),
                  },
                  input.operation as 'retry' | 'cancel' | 'cleanup',
                  input.commandId
                )
                Object.assign(snapshot, {
                  providerRevision: row.revision,
                  providerDigest: row.requestDigest,
                  providerScope: row.providerScope,
                  providerDeadline: row.nominalDeadline?.getTime() ?? null,
                  providerFloor: Number(row.floorUpper),
                })
              } catch (error) {
                if (!(error instanceof WorkPolicyError)) throw error
                snapshot.preflightReason = error.reason
              }
            }
            return results
          },
        } satisfies Partial<BrokerCommandPort>)
      : {}),
    dispatch: async (target) => {
      const preflight = z.object({ preflightReason: workReasonSchema }).safeParse(target.snapshot)
      if (preflight.success) return { state: 'rejected', reason: preflight.data.preflightReason }
      return connection.withClient(async (client) => {
        const snapshot = witnessSchema.parse(target.snapshot)
        if (
          !target.incarnation ||
          !target.dispatchId ||
          !target.dispatchAfter ||
          !target.dispatchUntil
        )
          throw new Error('INVALID_DISPATCH_WITNESS')
        const request = {
          id: target.targetId,
          fingerprint: snapshot.fingerprint,
          operation: input.operation as 'retry' | 'cancel' | 'cleanup',
          incarnation: target.incarnation,
          wireVersion: snapshot.wireVersion,
          policyVersion: snapshot.policyVersion,
          admittedAt: target.dispatchAfter.getTime(),
          dispatchNotAfter: target.dispatchUntil.getTime(),
          commandId: input.commandId,
          dispatchId: target.dispatchId,
          ...(input.operation === 'cleanup'
            ? {
                cleanup: {
                  cutoff: Date.parse(input.parameters.cutoff!),
                  minimumAgeMs: snapshot.minimumAgeMs,
                  state: z.enum(['completed', 'failed']).parse(snapshot.state),
                },
              }
            : {}),
        }
        const policy = target.snapshot as Record<string, unknown>
        const result =
          policy.replay === 'provider-window'
            ? await applyProviderWindowCommand(client, queue, request, {
                revision: Number(policy.providerRevision),
                digest: z.string().nullable().parse(policy.providerDigest),
                scope: z.string().nullable().parse(policy.providerScope),
                nominalDeadline: z.number().nullable().parse(policy.providerDeadline),
                floorUpper: Number(policy.providerFloor),
              })
            : await applyIdempotentCommand(client, queue, request)
        return result.status === 'applied'
          ? { state: 'applied' }
          : { state: 'rejected', reason: result.reason }
      })
    },
  }
}

function jobCommandSnapshot(
  definition: WorkDefinition,
  id: string,
  snapshot: import('@/infrastructure/background-work/job-snapshot').JobSnapshot
): CommandTargetSnapshot {
  const fields = snapshot.raw.fields
  let profile: ReturnType<typeof parseManagedJob>
  try {
    profile = parseManagedJob(definition, fields)
  } catch (error) {
    throw backgroundControlError(
      error instanceof Error && error.message === 'VERSION_UNSUPPORTED'
        ? 'VERSION_UNSUPPORTED'
        : 'CONTENT_UNSUPPORTED'
    )
  }
  const { envelope, binding } = profile
  if (binding.replay.kind === 'unsupported') throw backgroundControlError('ACTION_UNAVAILABLE')
  return {
    id,
    incarnation: envelope.incarnation,
    queueEpoch: snapshot.epoch,
    snapshot: {
      revision: snapshot.revision,
      fingerprint: snapshot.fingerprint,
      state: snapshot.state,
      wireVersion: envelope.jobVersion,
      policyVersion: envelope.executionPolicyVersion,
      replay: binding.replay.kind,
      jobName: fields.name!,
      automaticLimit: Number(JSON.parse(fields.opts!).attempts ?? 3),
      evidenceInitialized: fields.amEvidenceInitialized === '1',
      minimumAgeMs:
        snapshot.state === 'completed' ? binding.retention.completedMs : binding.retention.failedMs,
    },
  }
}
