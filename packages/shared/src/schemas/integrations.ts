import { z } from 'zod'

const instant = z.iso.datetime()
const slug = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)

export const INTEGRATIONS_MAX = 32
export const INTEGRATION_FACTS_MAX = 12

/**
 * A bounded slug rather than a shared enum: an integration registered downstream must never
 * break parsing of this privileged read. Known ids get message keys, others show the name.
 */
export const integrationIdSchema = slug

/** Axis 1: required settings are present. `configured` never means working. */
export const INTEGRATION_CONFIGURATIONS = ['disabled', 'not_configured', 'configured'] as const
/** Axis 2: what the last observation established for the current configuration. */
export const INTEGRATION_RESULTS = ['none', 'ok', 'failed', 'unknown', 'simulated'] as const
/** Axis 3: age of that observation. A failed result stays failed when it becomes stale. */
export const INTEGRATION_FRESHNESS = ['none', 'fresh', 'stale'] as const
/** Axis 4: the reader itself. Independent of the integration's health. */
export const INTEGRATION_SOURCES = ['ok', 'unavailable'] as const
export const INTEGRATION_SCOPES = [
  'private_file_write_read_delete',
  'broker_read',
  'provider_acceptance',
  'configuration_only',
] as const
export const INTEGRATION_INSTANCES = ['answering_instance', 'shared'] as const
/** Closed link set: the frontend maps each to its own href helper; a registration supplies no URL. */
export const INTEGRATION_LINKS = ['overview', 'background_work', 'runbook'] as const
/** Closed probe kinds: copy, recipient rule and receipt vocabulary are bound to the kind. */
export const INTEGRATION_PROBE_KINDS = ['operator_email_test'] as const
export const INTEGRATION_UNAVAILABLE_REASONS = [
  'no_verified_address',
  'mock_in_production',
  'cooldown',
  'limit',
  'busy',
] as const

/** Safe facts only: numbers, booleans and short strings without URL, path or `@` characters. */
const factValue = z.union([
  z.number().int().nonnegative(),
  z.boolean(),
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._ +,-]+$/),
])

export const integrationFactSchema = z.strictObject({ key: slug, value: factValue })

export const integrationEvidenceSchema = z.strictObject({
  result: z.enum(INTEGRATION_RESULTS),
  freshness: z.enum(INTEGRATION_FRESHNESS),
  scope: z.enum(INTEGRATION_SCOPES),
  instance: z.enum(INTEGRATION_INSTANCES),
  checkedAt: instant.nullable(),
  staleAfterSeconds: z.number().int().positive().nullable(),
  failure: slug.nullable(),
})
export type IntegrationEvidence = z.infer<typeof integrationEvidenceSchema>

export const integrationActionSchema = z.strictObject({
  probeId: slug,
  kind: z.enum(INTEGRATION_PROBE_KINDS),
  available: z.boolean(),
  unavailableReason: z.enum(INTEGRATION_UNAVAILABLE_REASONS).nullable(),
  cooldownRemainingSeconds: z.number().int().nonnegative(),
  ownAttemptId: z.string().nullable(),
})
export type IntegrationAction = z.infer<typeof integrationActionSchema>

export const integrationItemSchema = z.strictObject({
  id: integrationIdSchema,
  name: z.string().min(1).max(48),
  configuration: z.enum(INTEGRATION_CONFIGURATIONS),
  source: z.enum(INTEGRATION_SOURCES),
  evidence: integrationEvidenceSchema,
  facts: z.array(integrationFactSchema).max(INTEGRATION_FACTS_MAX),
  links: z.array(z.enum(INTEGRATION_LINKS)).max(3),
  action: integrationActionSchema.nullable(),
})
export type IntegrationItem = z.infer<typeof integrationItemSchema>

export const integrationsResponseSchema = z.strictObject({
  readAt: instant,
  items: z.array(integrationItemSchema).max(INTEGRATIONS_MAX),
})
export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>

/** Probe attempts. The id is minted by the server (PREPARE) and consumed by the first POST. */
export const probeAttemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/)

export const PROBE_STATES = ['reserved', 'sending', 'settled'] as const
export const PROBE_OUTCOMES = [
  'accepted',
  'simulated',
  'refused',
  'unknown',
  'not_started',
  'in_progress',
] as const
/** Safe explanation of an outcome: closed codes, never provider text. */
export const PROBE_CLASSES = [
  'auth',
  'invalid_sender',
  'invalid_request',
  'rate_limit',
  'quota',
  'deadline',
  'audit_failed',
  'lease_lost',
  'redis_timeout',
  'precheck',
  'abandoned',
  'busy',
] as const
export const PROBE_PROVIDERS = ['resend', 'mock'] as const

export const probeReceiptSchema = z.strictObject({
  attemptId: probeAttemptIdSchema,
  state: z.enum(PROBE_STATES),
  outcome: z.enum(PROBE_OUTCOMES),
  class: z.enum(PROBE_CLASSES).nullable(),
  provider: z.enum(PROBE_PROVIDERS),
  reservedAt: instant,
  settledAt: instant.nullable(),
})
export type ProbeReceipt = z.infer<typeof probeReceiptSchema>

export const probePreparationSchema = z.strictObject({
  attemptId: probeAttemptIdSchema,
  recipientHint: z.string().min(3).max(128),
  expiresAt: instant,
})
export type ProbePreparation = z.infer<typeof probePreparationSchema>

export const probeRequestSchema = z.strictObject({ attemptId: probeAttemptIdSchema })
export type ProbeRequest = z.infer<typeof probeRequestSchema>
