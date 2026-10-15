import { z } from 'zod'

import { adminQueueNameSchema } from './admin-queues'
import { serializedJsonBytes, utf8Bytes } from './organization-members-budget'
import { workFailureDiagnosticSchema } from './work-failure'
import { workPresentationSchema } from './work-presentation'

export * from './work-failure'
export { type WorkPresentation, workPresentationSchema } from './work-presentation'

/** Streamed command input ceiling; receipt responses have a separate 128KiB ceiling. */
export const WORK_CATALOGUE_BYTES = 64 * 1024
export const WORK_COMMAND_INPUT_BYTES = 32 * 1024
export const WORK_LIST_ROW_BYTES = 2 * 1024
export const WORK_DETAIL_BYTES = 16 * 1024
export const WORK_PUBLIC_RESPONSE_BYTES = 128 * 1024

export const WORK_OPERATIONS = ['retry', 'pause', 'resume', 'cancel', 'cleanup'] as const
export const workOperationSchema = z.enum(WORK_OPERATIONS)
export const WORK_REASONS = [
  'STATE_CHANGED',
  'ALREADY_IN_STATE',
  'CONTENT_UNSUPPORTED',
  'METADATA_UNAVAILABLE',
  'LIMIT_REACHED',
  'READ_LIMIT',
  'LEGACY_MIGRATION_REQUIRED',
  'VERSION_UNSUPPORTED',
  'WORK_UNAVAILABLE',
  'ACTION_UNAVAILABLE',
  'PRIORITY_RETRY_UNSUPPORTED',
  'MANUAL_GRANT_SPENT',
  'AUTOMATIC_BUDGET_SPENT',
  'ACTIVE_JOB',
  'RELATED_JOB',
  'HISTORY_EXPIRED',
  'PROVIDER_CHANGED',
  'REQUEST_EXPIRED',
  'HORIZON_EXPIRED',
  'FENCE_STALE',
  'CLOCK_UNCERTAIN',
  'OUTCOME_UNRECORDED',
  'EFFECT_UNKNOWN',
  'EFFECT_ACCEPTED',
  'COOLDOWN',
  'PERMANENT_FAILURE',
  'STORAGE_LIMIT',
  'COMMAND_CONFLICT',
  'COMMAND_EXPIRED',
  'RATE_LIMIT_EXCEEDED',
  'INCONSISTENT_STATE',
] as const
export const workReasonSchema = z.enum(WORK_REASONS)
export type WorkReason = z.infer<typeof workReasonSchema>
export type WorkOperation = z.infer<typeof workOperationSchema>

export const workJobIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const workRevisionSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/)
export const workTargetSchema = z.strictObject({
  id: workJobIdSchema,
  incarnation: z.uuid(),
  revision: workRevisionSchema,
})

export const workCommandSchema = z
  .strictObject({
    contractVersion: z.literal(1),
    commandId: z.uuidv7(),
    workId: adminQueueNameSchema,
    operation: workOperationSchema,
    targets: z.array(workTargetSchema).max(50),
    expectedWorkRevision: workRevisionSchema,
    reason: z.string().trim().min(1).max(250),
    parameters: z
      .strictObject({
        states: z
          .array(z.enum(['completed', 'failed']))
          .min(1)
          .max(2)
          .optional(),
        cutoff: z.iso.datetime().optional(),
      })
      .default({}),
  })
  .superRefine((command, ctx) => {
    const queueAction = command.operation === 'pause' || command.operation === 'resume'
    const ids = command.targets.map((target) => target.id)
    if ((queueAction ? ids.length !== 0 : ids.length === 0) || new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['targets'] })
    if (command.operation === 'cleanup') {
      if (!command.parameters.states || !command.parameters.cutoff)
        ctx.addIssue({ code: 'custom', path: ['parameters'] })
    } else if (Object.keys(command.parameters).length > 0) {
      ctx.addIssue({ code: 'custom', path: ['parameters'] })
    }
  })
export type WorkCommand = z.infer<typeof workCommandSchema>

export const workCapabilitySchema = z.strictObject({
  operation: workOperationSchema,
  allowed: z.boolean(),
  reason: workReasonSchema.optional(),
})

export const workListQuerySchema = z
  .strictObject({
    search: z.string().trim().max(128).optional(),
    filters: z
      .union([
        z
          .string()
          .max(1024)
          .refine((value) => utf8Bytes(value) <= 1024),
        z.record(z.string().max(64), z.string().min(1).max(64)),
      ])
      .transform((value, ctx) => {
        try {
          const result = z
            .record(z.string().max(64), z.string().min(1).max(64))
            .parse(typeof value === 'string' ? JSON.parse(value) : value)
          if (Object.keys(result).length > 4 || serializedJsonBytes(result) > 1024)
            throw new Error()
          return result
        } catch {
          ctx.addIssue({ code: 'custom' })
          return z.NEVER
        }
      })
      .optional(),
    source: z.enum(['broker', 'PG_evidence']).optional(),
    state: z
      .enum(['waiting', 'active', 'delayed', 'prioritized', 'failed', 'completed'])
      .default('failed'),
    page: z.coerce.number().int().min(1).max(512).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .superRefine((query, ctx) => {
    if (query.page > Math.ceil(512 / query.limit)) ctx.addIssue({ code: 'custom', path: ['page'] })
  })
/** HTTP accepts one JSON string; internal readers may revalidate decoded filters. */
export const workListWireQuerySchema = z.preprocess((input) => {
  if (
    input &&
    typeof input === 'object' &&
    'filters' in input &&
    (input as { filters?: unknown }).filters !== undefined &&
    typeof (input as { filters?: unknown }).filters !== 'string'
  )
    return { ...input, filters: [] }
  return input
}, workListQuerySchema)
export type WorkListQuery = z.infer<typeof workListQuerySchema>

const workCountSchema = z.strictObject({
  value: z.number().int().min(0).max(10000),
  truncated: z.boolean(),
})

export const workSummarySchema = z.strictObject({
  id: adminQueueNameSchema,
  kind: z.enum(['ordinary', 'wake', 'external', 'durable']),
  status: z.enum(['available', 'unavailable', 'disabled']),
  definitionVersion: z.number().int().positive(),
  sampledAt: z.iso.datetime(),
  revision: workRevisionSchema.optional(),
  epoch: z.uuid().optional(),
  counts: z
    .strictObject({
      pending: workCountSchema,
      due: workCountSchema,
      processing: workCountSchema,
      failed: workCountSchema,
      terminal: workCountSchema,
      unresolved: workCountSchema,
      completed: workCountSchema.optional(),
    })
    .optional(),
  paused: z.boolean().optional(),
  providerEvidence: z.boolean().optional(),
  presentation: workPresentationSchema.optional(),
  capabilities: z.array(workCapabilitySchema).max(5),
})
export type WorkSummary = z.infer<typeof workSummarySchema>
export const workCatalogueSchema = z
  .array(workSummarySchema)
  .max(64)
  .refine((value) => serializedJsonBytes(value) <= WORK_CATALOGUE_BYTES)

const workJobFieldsSchema = z.strictObject({
  identity: workTargetSchema,
  state: z.enum([
    'waiting',
    'active',
    'delayed',
    'prioritized',
    'failed',
    'completed',
    'missing',
    'unavailable',
  ]),
  jobName: z.string().min(1).max(64),
  wireVersion: z.number().int().positive(),
  sampledAt: z.iso.datetime(),
  source: z.enum(['broker', 'PG_evidence', 'domain']),
  replay: z.enum(['idempotent', 'provider-window', 'unsupported', 'durable']),
  failure: workFailureDiagnosticSchema.optional(),
  report: z.enum(['none', 'success', 'failure', 'unrecorded']).optional(),
  certainty: z.enum(['none', 'accepted', 'unknown']).optional(),
  attemptsStarted: z.number().int().nonnegative(),
  attemptsMade: z.number().int().nonnegative().optional(),
  manualGrant: z.enum(['none', 'reserved', 'spent']),
  reconciliation: z
    .strictObject({
      revision: z.number().int().nonnegative(),
      allowed: z.boolean(),
      reason: workReasonSchema.optional(),
    })
    .optional(),
  nativeState: z.string().max(64).optional(),
  cancellationRequestedAt: z.iso.datetime().optional(),
  nextAttemptAt: z.iso.datetime().optional(),
  projection: z.record(
    z.string().max(64),
    z.union([z.string().max(256), z.number().finite(), z.boolean()])
  ),
  capabilities: z.array(workCapabilitySchema).max(5),
})
export const workAttemptHistorySchema = z.strictObject({
  attempts: z
    .array(
      z
        .strictObject({
          number: z.number().int().positive(),
          startedAt: z.iso.datetime(),
          finishedAt: z.iso.datetime().optional(),
          outcome: z.enum([
            'active',
            'delivered',
            'transient_failure',
            'permanent_failure',
            'abandoned',
            'succeeded',
            'retry_scheduled',
            'failed',
            'cancelled',
            'expired',
            'superseded',
            'awaiting_approval',
            'lease_lost',
            'reaped',
            'effect_unknown',
          ]),
          certainty: z.enum(['none', 'accepted', 'unknown']),
          reason: z.string().max(64).optional(),
          actorId: z.string().max(64).optional(),
          commandId: z.uuid().optional(),
        })
        .refine((value) => serializedJsonBytes(value) <= 512)
    )
    .max(16),
  historyTruncated: z.boolean(),
  historyExpired: z.boolean(),
  oldestRetainedNumber: z.number().int().positive().optional(),
})
export const workJobSchema = workJobFieldsSchema
  .extend({ history: workAttemptHistorySchema.optional() })
  .refine((value) => serializedJsonBytes(value) <= WORK_DETAIL_BYTES)
export const workListRowSchema = workJobFieldsSchema.refine(
  (value) => serializedJsonBytes(value) <= WORK_LIST_ROW_BYTES
)
export type WorkJob = z.infer<typeof workJobSchema>

export const workPageSchema = z
  .strictObject({
    workId: adminQueueNameSchema,
    sampledAt: z.iso.datetime(),
    rows: z.array(workListRowSchema).max(50),
    windowTruncated: z.boolean(),
    reason: workReasonSchema.optional(),
  })
  .refine((value) => serializedJsonBytes(value) <= WORK_PUBLIC_RESPONSE_BYTES)
export type WorkPage = z.infer<typeof workPageSchema>

export const workTargetReceiptSchema = z.strictObject({
  id: workJobIdSchema,
  incarnation: z.uuid().optional(),
  state: z.enum(['prepared', 'dispatching', 'applied', 'rejected', 'not_attempted', 'unknown']),
  deadlineExceeded: z.boolean().optional(),
  reason: workReasonSchema.optional(),
  resolution: z.enum(['none', 'acknowledged_unknown', 'proven_applied', 'proven_no_effect']),
})
export const workReceiptSchema = z
  .strictObject({
    commandId: z.uuidv7(),
    workId: adminQueueNameSchema,
    operation: workOperationSchema,
    state: z.enum(['requested', 'applying', 'applied', 'rejected', 'not_attempted', 'partial']),
    unknownCount: z.number().int().min(0).max(50),
    createdAt: z.iso.datetime(),
    reason: z.string().max(250).optional(),
    revision: z.number().int().nonnegative(),
    targets: z.array(workTargetReceiptSchema).max(50),
  })
  .refine((value) => serializedJsonBytes(value) <= WORK_PUBLIC_RESPONSE_BYTES)
export type WorkReceipt = z.infer<typeof workReceiptSchema>

export const workReconciliationSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  disposition: z.literal('acknowledged_unknown'),
  reason: z.string().trim().min(1).max(250),
  references: z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/)
    )
    .max(3),
  incarnation: z.uuid().optional(),
})
export type WorkReconciliation = z.infer<typeof workReconciliationSchema>
export const workEvidenceReconciliationSchema = workReconciliationSchema.extend({
  incarnation: z.uuidv7(),
})
