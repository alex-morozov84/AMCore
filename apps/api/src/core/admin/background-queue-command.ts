import { z } from 'zod'

import { type WorkCommand, workReasonSchema } from '@amcore/shared'

import type { BrokerCommandPort } from './background-command-service'
import type { CommandOutcome } from './background-command-settlement'
import { backgroundControlError } from './background-control-error'

import type { BackgroundCommandTarget } from '@/generated/prisma/client'
import { ControlConnection } from '@/infrastructure/background-work/control-connection'
import { readQueueSnapshot } from '@/infrastructure/background-work/queue-snapshot'
import { applyQueueControl } from '@/infrastructure/background-work/scripts/queue-control'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const dispatchSnapshot = z.object({
  controlRevision: integer,
  nextRevision: integer,
  paused: z.boolean(),
})

/** Code-owned queue prefix, fixed-key reads/actions and no backlog enumeration. */
export function queueCommandPort(
  connection: ControlConnection,
  prefix: string,
  input: WorkCommand
): BrokerCommandPort {
  if (input.operation !== 'pause' && input.operation !== 'resume')
    throw backgroundControlError('ACTION_UNAVAILABLE')
  const operation = input.operation
  return {
    observe: () =>
      connection.withClient(async (client) => {
        const result = await readQueueSnapshot(client, prefix)
        if (result.status !== 'observed')
          throw backgroundControlError(workReasonSchema.parse(result.reason))
        const snapshot = result.snapshot
        return [
          {
            id: input.workId,
            queueEpoch: snapshot.epoch,
            snapshot: {
              revision: snapshot.revision,
              controlRevision: snapshot.controlRevision,
              paused: snapshot.paused,
              layout: snapshot.layout,
            },
          },
        ]
      }),
    dispatch: (target) => dispatchQueue(connection, prefix, operation, target),
  }
}

async function dispatchQueue(
  connection: ControlConnection,
  prefix: string,
  operation: 'pause' | 'resume',
  target: BackgroundCommandTarget
): Promise<CommandOutcome> {
  const snapshot = dispatchSnapshot.parse(target.snapshot)
  if (!target.queueEpoch || !target.dispatchAfter || !target.dispatchUntil)
    throw new Error('INVALID_DISPATCH_WITNESS')
  return connection.withClient(async (client) => {
    const result = await applyQueueControl(client, {
      prefix,
      operation,
      epoch: target.queueEpoch!,
      revision: snapshot.controlRevision,
      nextRevision: snapshot.nextRevision,
      paused: snapshot.paused,
      admittedAt: target.dispatchAfter!.getTime(),
      dispatchNotAfter: target.dispatchUntil!.getTime(),
    })
    return result.status === 'applied'
      ? { state: 'applied' }
      : { state: 'rejected', reason: workReasonSchema.parse(result.code) }
  })
}
