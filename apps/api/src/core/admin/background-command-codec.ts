import { createHash } from 'node:crypto'

import {
  WORK_COMMAND_INPUT_BYTES,
  type WorkCommand,
  workCommandSchema,
  type WorkReceipt,
  workReceiptSchema,
} from '@amcore/shared'

import { backgroundControlError } from './background-control-error'

import type { BackgroundCommand, BackgroundCommandTarget } from '@/generated/prisma/client'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'

export function canonicalWorkCommand(
  input: WorkCommand,
  definitionVersion: number
): {
  readonly command: WorkCommand
  readonly fingerprint: string
  readonly bytes: number
} {
  const command = workCommandSchema.parse({
    ...input,
    reason: input.reason.trim().normalize('NFC'),
    targets: [...input.targets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    parameters: {
      ...(input.parameters.states ? { states: [...new Set(input.parameters.states)].sort() } : {}),
      ...(input.parameters.cutoff
        ? { cutoff: new Date(input.parameters.cutoff).toISOString() }
        : {}),
    },
  })
  const encoded = JSON.stringify({ definitionVersion, ...command })
  // Target identities/snapshots are accounted in child rows, not the 8KiB parent ceiling.
  const bytes = Buffer.byteLength(JSON.stringify({ ...command, targets: [] }), 'utf8') + 512
  if (
    bytes > CONTROL_LIMITS.commandBytes ||
    Buffer.byteLength(encoded, 'utf8') > WORK_COMMAND_INPUT_BYTES ||
    Buffer.byteLength(command.reason, 'utf8') > 1024
  )
    throw backgroundControlError('CONTENT_UNSUPPORTED')
  return { command, bytes, fingerprint: createHash('sha256').update(encoded).digest('hex') }
}

/** Deadline observations do not fabricate a persisted outcome or turn ambiguity into rejection. */
export function projectWorkReceipt(
  command: BackgroundCommand,
  targets: readonly BackgroundCommandTarget[],
  dbNow: Date
): WorkReceipt {
  if (targets.length < 1 || targets.length > CONTROL_LIMITS.batchTargets)
    throw backgroundControlError('INCONSISTENT_STATE')
  const rows = targets.map((target) => ({
    id: target.targetId,
    incarnation: target.incarnation ?? undefined,
    state: target.state,
    reason: target.reason ?? undefined,
    resolution: target.resolution,
    deadlineExceeded:
      (target.state === 'prepared' || target.state === 'dispatching') &&
      (target.dispatchUntil ?? command.dispatchUntil).getTime() < dbNow.getTime(),
  }))
  const unknownCount = rows.filter(
    (row) => row.state === 'unknown' || (row.state === 'dispatching' && row.deadlineExceeded)
  ).length
  const state = rows.some((row) => row.state === 'prepared')
    ? 'requested'
    : rows.some((row) => row.state === 'dispatching')
      ? 'applying'
      : rows.every((row) => row.state === 'applied')
        ? 'applied'
        : rows.every((row) => row.state === 'rejected')
          ? 'rejected'
          : rows.every((row) => row.state === 'not_attempted')
            ? 'not_attempted'
            : 'partial'
  const receipt = workReceiptSchema.parse({
    commandId: command.commandId,
    workId: command.workId,
    operation: command.operation,
    createdAt: command.createdAt.toISOString(),
    reason: command.reason || undefined,
    revision: command.revision,
    state,
    unknownCount,
    targets: rows,
  })
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 128 * 1024)
    throw backgroundControlError('READ_LIMIT')
  return receipt
}

/** Only new intents expire; retained authorized replays and receipt reads do not. */
export function assertNewWorkCommandTime(commandId: string, now: Date): void {
  const timestamp = Number.parseInt(commandId.replaceAll('-', '').slice(0, 12), 16)
  const age = now.getTime() - timestamp
  if (!Number.isSafeInteger(timestamp) || age > 86400000 || age < -300000)
    throw backgroundControlError('COMMAND_EXPIRED')
}
