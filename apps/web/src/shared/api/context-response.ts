import { contextSessionBindingSchema } from '@amcore/shared'
import { z } from 'zod'

/** Browser envelopes carry identity, never authority. A result from another session is discarded. */
export function parseContextResponse<T>(binding: string, schema: z.ZodType<T>, value: unknown): T {
  const result = z.strictObject({ binding: contextSessionBindingSchema, data: schema }).parse(value)
  if (result.binding !== binding) throw new Error('CONTEXT_SESSION_CHANGED')
  return result.data
}
