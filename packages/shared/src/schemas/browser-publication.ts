import { z } from 'zod'

export const BROWSER_AUTH_HEADERS = Object.freeze({
  key: 'x-amcore-browser-context-key',
  audience: 'x-amcore-browser-audience',
  binding: 'x-amcore-browser-binding',
  contextId: 'x-amcore-browser-context',
  generation: 'x-amcore-browser-generation',
})

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

export const browserBootstrapInputSchema = z
  .object({
    binding: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .strict()
export const browserBootstrapResultSchema = z.discriminatedUnion('kind', [
  browserContextBootstrapSchema.extend({ kind: z.literal('created') }).strict(),
  z.object({ kind: z.literal('existing'), view: browserContextViewSchema }).strict(),
])
export const browserBindingProbeInputSchema = z
  .object({
    refreshToken: z.string().regex(/^[a-f0-9]{64}$/),
    familyId: z.string().min(1).max(128),
    securityVersion: z.number().int().nonnegative(),
  })
  .strict()
export const browserBindingProbeResultSchema = browserRevisionSchema
  .extend({
    status: z.literal('current'),
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
    securityVersion: z.number().int().nonnegative(),
    audience: browserAudienceSchema,
  })
  .strict()

export type BrowserBootstrapInput = z.infer<typeof browserBootstrapInputSchema>
export type BrowserBootstrapResult = z.infer<typeof browserBootstrapResultSchema>
export type BrowserBindingProbeInput = z.infer<typeof browserBindingProbeInputSchema>
export type BrowserBindingProbeResult = z.infer<typeof browserBindingProbeResultSchema>
