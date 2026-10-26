import { z } from 'zod'

export const browserAudienceSchema = z.enum(['product', 'staff', 'console'])
export const browserRevisionSchema = z
  .object({
    contextId: z.string().min(1).max(128),
    generation: z.number().int().nonnegative().max(2147483647),
  })
  .strict()

/** Account-neutral status; a binding capability must never reveal an identity or credentials. */
export const browserContextViewSchema = browserRevisionSchema
  .extend({
    state: z.enum(['empty', 'reserved', 'published', 'logged_out']),
    expiresAt: z.iso.datetime(),
  })
  .strict()

/** Backend-to-BFF only; the BFF emits the binding only as an HttpOnly cookie. */
export const browserContextBootstrapSchema = z
  .object({
    binding: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    view: browserContextViewSchema,
  })
  .strict()

export type BrowserAudience = z.infer<typeof browserAudienceSchema>
export type BrowserRevision = z.infer<typeof browserRevisionSchema>
export type BrowserContextView = z.infer<typeof browserContextViewSchema>
export type BrowserContextBootstrap = z.infer<typeof browserContextBootstrapSchema>
