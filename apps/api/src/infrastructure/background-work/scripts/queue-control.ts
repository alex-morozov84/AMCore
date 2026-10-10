import type { Redis } from 'ioredis'
import { z } from 'zod'

import { QUEUE_CONTROL_LUA } from './queue-control.lua'

export interface QueueControlCommand {
  readonly prefix: string
  readonly epoch: string
  readonly revision: number
  readonly nextRevision: number
  readonly paused: boolean
  readonly operation: 'pause' | 'resume'
  readonly dispatchNotAfter: number
  readonly admittedAt: number
}

export type QueueControlResult =
  { status: 'applied'; revision: number; paused: boolean } | { status: 'rejected'; code: string }

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const commandSchema = z
  .strictObject({
    prefix: z.string().min(1).max(256),
    epoch: z.uuidv7(),
    revision: integer,
    nextRevision: integer,
    paused: z.boolean(),
    operation: z.enum(['pause', 'resume']),
    dispatchNotAfter: integer,
    admittedAt: integer,
  })
  .refine((command) => command.nextRevision > command.revision)

/** The caller owns a fail-fast, non-resending connection and durable ADMIN intent. */
export async function applyQueueControl(
  client: Redis,
  command: QueueControlCommand
): Promise<QueueControlResult> {
  commandSchema.parse(command)
  const names = ['meta', 'wait', 'paused', 'active', 'prioritized', 'delayed', 'marker', 'events']
  const keys = names.map((name) => `${command.prefix}${name}`)
  const result = await client.eval(
    QUEUE_CONTROL_LUA,
    keys.length,
    ...keys,
    command.epoch,
    String(command.revision),
    String(command.nextRevision),
    command.paused ? '1' : '0',
    command.operation,
    String(command.dispatchNotAfter),
    String(command.admittedAt)
  )
  if (!Array.isArray(result)) throw new Error('Invalid queue-control response')
  if (result[0] === 'rejected' && result.length === 2 && typeof result[1] === 'string')
    return { status: 'rejected', code: result[1] }
  if (result[0] !== 'applied' || result.length !== 3 || !['0', '1'].includes(result[2] as string))
    throw new Error('Invalid queue-control response')
  return {
    status: 'applied',
    revision: integer.parse(Number(result[1])),
    paused: result[2] === '1',
  }
}
