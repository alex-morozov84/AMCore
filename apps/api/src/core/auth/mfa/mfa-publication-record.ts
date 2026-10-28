import { z } from 'zod'

import { browserAudienceSchema, browserRevisionSchema } from '@amcore/shared'

import type { MfaFlow } from '../../../generated/prisma/client.js'

import { mfaHash } from './mfa-secrets.js'

/** Trusted committed operation data; no plaintext credentials or replay cache. */
export const publicationRecordSchema = z
  .object({
    kind: z.literal('issued_family'),
    familyId: z.string().min(1),
    sessionId: z.string().min(1),
    securityVersion: z.number().int().nonnegative(),
    browser: browserRevisionSchema
      .extend({
        audience: browserAudienceSchema,
        stagedBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .nullable(),
    invitation: z
      .object({
        attemptId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
        inviteId: z.string().min(1),
        organizationId: z.string().min(1),
        generation: z.number().int().positive(),
        recipient: z.string().min(1).max(254),
      })
      .strict()
      .nullable(),
    transferId: z.string().min(1).nullable(),
  })
  .strict()
export type PublicationRecord = z.infer<typeof publicationRecordSchema>

export function publicationSecretHash(kind: 'receipt' | 'vault', value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? mfaHash(JSON.stringify(['mfa-publication-v1', kind, value]))
    : null
}
/** Identity-derived committed issuance only; setup transfers remain closed until their durable validator exists. */
export function independentPublicationSource(flow: MfaFlow, record: PublicationRecord): boolean {
  return (
    ['login', 'initial_setup'].includes(flow.purpose) &&
    flow.authorityKind === 'identity' &&
    flow.sourceFamilyId === null &&
    flow.sourceSecurityVersion === null &&
    flow.transferId === null &&
    record.transferId === null
  )
}

/** Shape is only a prefilter; setup successors additionally require their locked durable transfer. */
export function declaredPublicationSource(flow: MfaFlow, record: PublicationRecord): boolean {
  return (
    independentPublicationSource(flow, record) ||
    (flow.authorityKind === 'setup_successor' &&
      flow.purpose === 'initial_setup' &&
      flow.sourceFamilyId === null &&
      flow.sourceSecurityVersion === null &&
      flow.transferId !== null &&
      record.transferId === flow.transferId)
  )
}

export function committedPublicationSource(flow: MfaFlow, record: PublicationRecord): boolean {
  return ['committed', 'completed'].includes(flow.state) && declaredPublicationSource(flow, record)
}
