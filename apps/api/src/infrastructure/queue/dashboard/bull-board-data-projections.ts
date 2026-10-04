import { z } from 'zod'

import { SUPPORTED_LOCALES } from '@amcore/shared'

import { QUEUEABLE_EMAIL_TEMPLATES } from '../../email/email.types'
import { QueueName } from '../constants/queues.constant'

/**
 * What the board may show of a job's `data`, per queue. A projection receives the raw payload and
 * returns a small object rebuilt ONLY from validated, allowed fields, or `null` to hide the whole
 * payload. The default is hiding: a queue without an entry here (the downstream `default` queue,
 * any queue added later) shows `[hidden]`. Downstream code that wants its own payload visible adds
 * an entry below and its own tests; nothing is inferred from a key being named "safe".
 *
 * A value passes only if its TYPE, LENGTH and FORMAT are right, so a secret placed in an allowed key
 * (an identifier that is really a token URL, an over-long string, a nested object) is hidden rather
 * than shown because the key name was allowed. Recipient addresses and names are never projected.
 */
export type BoardDataProjection = (data: unknown) => Readonly<Record<string, string>> | null

/** Opaque identifier: a database id or similar. No spaces, no URL characters, bounded. */
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

const emailCandidate = z.object({
  template: z
    .string()
    .refine((value) => (QUEUEABLE_EMAIL_TEMPLATES as ReadonlySet<string>).has(value)),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  userId: identifier.optional(),
})

const notificationCandidate = z.object({ notificationId: identifier })
const aiRunWakeCandidate = z.object({ runId: identifier })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compact(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
}

/** Real email job: `{ template, to, userId?, data: { name, email, locale? } }` (`email.schema.ts`). */
export const projectEmailJobData: BoardDataProjection = (data) => {
  if (!isRecord(data)) return null
  const inner = isRecord(data.data) ? data.data : {}
  const parsed = emailCandidate.safeParse({
    template: data.template,
    locale: inner.locale,
    userId: data.userId,
  })
  return parsed.success ? compact(parsed.data) : null
}

/** Notification wake job: `{ notificationId }` (`DispatchDueJob`). */
export const projectNotificationJobData: BoardDataProjection = (data) => {
  const parsed = notificationCandidate.safeParse(data)
  return parsed.success ? { notificationId: parsed.data.notificationId } : null
}

/** AI run wake job: `{ runId }` (`AiRunWakeJob`). */
export const projectAiRunWakeJobData: BoardDataProjection = (data) => {
  const parsed = aiRunWakeCandidate.safeParse(data)
  return parsed.success ? { runId: parsed.data.runId } : null
}

export const BOARD_DATA_PROJECTIONS: Readonly<Partial<Record<string, BoardDataProjection>>> = {
  [QueueName.EMAIL]: projectEmailJobData,
  [QueueName.NOTIFICATIONS]: projectNotificationJobData,
  [QueueName.AI_RUNS]: projectAiRunWakeJobData,
}
