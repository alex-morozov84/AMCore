import { z } from 'zod'

export const browserReturnProofSchema = z
  .object({
    operationId: z.string().uuid(),
    returnEntryId: z.string().uuid(),
    receiptSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    neutralAttemptId: z.string().uuid(),
  })
  .strict()
export const browserLogoutReceiptInputSchema = browserReturnProofSchema
  .omit({ neutralAttemptId: true })
  .extend({ expiresAt: z.iso.datetime(), refreshToken: z.string().min(1).max(4096).optional() })
  .strict()
export const browserLogoutReceiptLookupSchema = browserReturnProofSchema
  .omit({ neutralAttemptId: true })
  .strict()
export const browserLogoutReceiptResultSchema = z
  .object({
    state: z.enum([
      'not_found',
      'logged_out',
      'claimed',
      'reserved',
      'published',
      'superseded',
      'expired',
    ]),
    operationId: z.string().uuid(),
    returnEntryId: z.string().uuid(),
    contextId: z.string().optional(),
    audience: z.enum(['product', 'staff', 'console']).optional(),
    beforeGeneration: z.number().int().nonnegative().optional(),
    afterGeneration: z.number().int().nonnegative().optional(),
    neutralAttemptId: z.string().uuid().optional(),
    flowId: z.string().optional(),
    reservedGeneration: z.number().int().nonnegative().optional(),
    completionId: z.string().uuid().optional(),
    familyId: z.string().optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict()
export type BrowserReturnProof = z.infer<typeof browserReturnProofSchema>
export type BrowserLogoutReceiptInput = z.infer<typeof browserLogoutReceiptInputSchema>
export type BrowserLogoutReceiptLookup = z.infer<typeof browserLogoutReceiptLookupSchema>
export type BrowserLogoutReceiptResult = z.infer<typeof browserLogoutReceiptResultSchema>
