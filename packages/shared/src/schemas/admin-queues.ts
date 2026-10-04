import { z } from 'zod'

/** Queue kind: `work` carries jobs, `wake` only nudges a durable database worker, `extension` is downstream-defined. */
export const ADMIN_QUEUE_KINDS = ['work', 'wake', 'extension'] as const

/**
 * A bounded slug rather than a shared enum: a queue added downstream must never
 * break parsing of this privileged read. Known names get fixed UI copy, others a
 * generic one by kind.
 */
export const adminQueueNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

const count = z.number().int().nonnegative()
const instant = z.iso.datetime()

/** Raw BullMQ state sizes. UI "Waiting" is `waiting + prioritized`. */
export const adminQueueCountsSchema = z.object({
  waiting: count,
  prioritized: count,
  active: count,
  delayed: count,
  failed: count,
  waitingChildren: count,
})
export type AdminQueueCounts = z.infer<typeof adminQueueCountsSchema>

/**
 * Creation-based lower bound on the age of the oldest queued job, measured over a
 * small bounded sample. `none`: nothing is queued. `unknown`: jobs are queued but
 * no valid timestamp could be read.
 */
export const adminQueueAgeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('sample'), seconds: count, sampled: count }),
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('unknown') }),
])
export type AdminQueueAge = z.infer<typeof adminQueueAgeSchema>

const identity = { name: adminQueueNameSchema, kind: z.enum(ADMIN_QUEUE_KINDS) }

export const adminQueueSchema = z.discriminatedUnion('status', [
  z.object({
    ...identity,
    status: z.literal('available'),
    sampledAt: instant,
    paused: z.boolean(),
    counts: adminQueueCountsSchema,
    age: adminQueueAgeSchema,
  }),
  z.object({ ...identity, status: z.literal('unavailable') }),
  z.object({ ...identity, status: z.literal('disabled') }),
])
export type AdminQueue = z.infer<typeof adminQueueSchema>

/**
 * A successful observation is HTTP 200 even when Redis could not be read: a
 * failing row is `unavailable`, never zeros. Request-level failures stay 401/403/429/5xx.
 */
export const adminQueuesResponseSchema = z.object({
  checkedAt: instant,
  queues: z.array(adminQueueSchema),
})
export type AdminQueuesResponse = z.infer<typeof adminQueuesResponseSchema>
