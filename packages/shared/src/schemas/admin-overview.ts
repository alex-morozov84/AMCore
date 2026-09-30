import { z } from 'zod'

/** Only these dependency names may cross the privileged Overview boundary. */
export const ADMIN_OVERVIEW_DEPENDENCY_NAMES = [
  'database',
  'redis',
  'disk',
  'memory_heap',
  'storage',
] as const

export const adminOverviewDependencySchema = z.object({
  name: z.enum(ADMIN_OVERVIEW_DEPENDENCY_NAMES),
  status: z.enum(['up', 'down', 'degraded', 'unknown']),
})
export type AdminOverviewDependency = z.infer<typeof adminOverviewDependencySchema>

const count = z.number().int().nonnegative()
const bytes = count
const sampledAt = z.iso.datetime()
const available = z.object({ status: z.literal('available'), sampledAt })
const unavailable = z.object({ status: z.literal('unavailable'), sampledAt: z.null() })

/** Local pg.Pool counts; these do not establish database connectivity. */
export const adminOverviewPoolSchema = z.discriminatedUnion('status', [
  available.extend({
    total: count,
    idle: count,
    waiting: count,
    max: z.number().int().positive(),
    waitingThreshold: count,
  }),
  unavailable,
])

/** Process heap/RSS, never container or host memory. Only heap has a health limit. */
export const adminOverviewMemorySchema = z.discriminatedUnion('status', [
  available.extend({
    heapUsedBytes: bytes,
    rssBytes: bytes,
    readinessHeapLimitBytes: z.number().int().positive(),
  }),
  unavailable,
])

/** Capacity pressure uses unprivileged available blocks, including reserved space. */
export const adminOverviewFilesystemSchema = z.discriminatedUnion('status', [
  available
    .extend({
      path: z.literal('/'),
      totalBytes: z.number().int().positive(),
      availableBytes: bytes,
      pressureRatio: z.number().min(0).max(1),
      pressureThreshold: z.number().min(0).max(1),
    })
    .refine((value) => value.availableBytes <= value.totalBytes),
  unavailable,
])

export const adminOverviewResourcesSchema = z.object({
  pool: adminOverviewPoolSchema,
  memory: adminOverviewMemorySchema,
  filesystem: adminOverviewFilesystemSchema,
})
export type AdminOverviewResources = z.infer<typeof adminOverviewResourcesSchema>

const declaredMetadata = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._+-]+$/)
  .nullable()
const deploymentLabel = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
  .nullable()

/** A successful observation is 200 even if not ready; request errors are separate.
 * Numeric samples are independent of the readiness indicator's actual samples.
 */
export const adminOverviewResponseSchema = z.object({
  readiness: z.enum(['ready', 'degraded', 'not_ready']),
  dependencies: z.array(adminOverviewDependencySchema),
  version: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._+-]+$/),
  processRole: z.enum(['web', 'worker', 'all']),
  checkedAt: sampledAt,
  storageHealthEnabled: z.boolean(),
  api: z.object({
    version: declaredMetadata,
    commit: declaredMetadata,
    deploymentId: deploymentLabel,
    environment: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .nullable(),
    runtimeMode: z.enum(['development', 'production', 'test']),
  }),
  process: z.object({
    instanceId: z.uuid(),
    uptimeSeconds: z.number().finite().nonnegative(),
    sampledAt,
  }),
  resources: adminOverviewResourcesSchema,
})
export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>
