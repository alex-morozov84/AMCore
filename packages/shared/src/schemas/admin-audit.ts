import { z } from 'zod'

export const auditDisplayIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
export const auditActionCodeSchema = z
  .string()
  .min(3)
  .max(96)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
const utcTime = z.iso.datetime({ offset: false })

export const adminAuditQuerySchema = z
  .object({
    actorId: auditDisplayIdSchema.optional(),
    actorType: z.enum(['USER', 'API_KEY', 'SYSTEM']).optional(),
    action: auditActionCodeSchema.optional(),
    targetId: auditDisplayIdSchema.optional(),
    targetType: z
      .enum([
        'USER',
        'API_KEY',
        'ORG_INVITE',
        'ORGANIZATION',
        'SESSION',
        'CLEANUP',
        'TELEGRAM_CONNECTION',
        'AI_RUN',
        'AI_TOOL_INVOCATION',
        'AI_APPROVAL',
        'AI_ASSISTANT',
        'AI_CONVERSATION',
      ])
      .optional(),
    organizationId: auditDisplayIdSchema.optional(),
    from: utcTime.optional(),
    to: utcTime.optional(),
    limit: z
      .union([z.string().regex(/^[1-9][0-9]?$/), z.number().int().min(1).max(50)])
      .transform(Number)
      .pipe(z.number().int().max(50))
      .default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>

const currentUser = z.object({
  status: z.literal('current'),
  name: z.string().min(1).max(120).optional(),
  email: z.email().max(255).optional(),
})
const currentOrganization = z.object({
  status: z.literal('current'),
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(120).optional(),
})
const missingIdentity = z.object({ status: z.literal('not_found') })
export const auditUserIdentitySchema = z.union([currentUser, missingIdentity])
export const auditOrganizationIdentitySchema = z.union([currentOrganization, missingIdentity])

const summaryCode = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)
export const auditSummarySchema = z
  .object({
    beforeSystemRole: z.enum(['USER', 'SUPER_ADMIN']).optional(),
    afterSystemRole: z.enum(['USER', 'SUPER_ADMIN']).optional(),
    count: z.number().int().min(0).max(1_000_000).optional(),
    decision: summaryCode.optional(),
    reasonCode: summaryCode.optional(),
    outcome: summaryCode.optional(),
  })
  .strict()

export const adminAuditItemSchema = z.object({
  id: auditDisplayIdSchema.nullable(),
  createdAt: utcTime,
  actorType: z.enum(['USER', 'API_KEY', 'SYSTEM']),
  actorId: auditDisplayIdSchema.nullable(),
  actorIdentity: auditUserIdentitySchema.optional(),
  action: auditActionCodeSchema.nullable(),
  targetType: adminAuditQuerySchema.shape.targetType.unwrap().nullable(),
  targetId: auditDisplayIdSchema.nullable(),
  targetIdentity: auditUserIdentitySchema.optional(),
  targetOrganizationIdentity: auditOrganizationIdentitySchema.optional(),
  organizationId: auditDisplayIdSchema.nullable(),
  organizationIdentity: auditOrganizationIdentitySchema.optional(),
  category: z.enum(['SECURITY', 'BUSINESS']),
  summary: auditSummarySchema,
})

export const adminAuditResponseSchema = z
  .object({
    items: z.array(adminAuditItemSchema).max(50),
    hasMore: z.boolean(),
    nextCursor: z.string().max(512).nullable(),
    from: utcTime,
    to: utcTime,
  })
  .strict()

export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>

export const adminAuditLookupInputSchema = z
  .object({
    kind: z.enum(['user', 'organization']),
    search: z
      .string()
      .min(2)
      .max(80)
      .trim()
      .refine((value) => {
        if (value.length < 2) return false
        for (const char of value)
          if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false
        return true
      }),
  })
  .strict()

export const adminAuditLookupResponseSchema = z.object({
  kind: z.enum(['user', 'organization']),
  items: z
    .array(
      z.object({
        id: auditDisplayIdSchema,
        name: z.string().min(1).max(120).optional(),
        email: z.email().max(255).optional(),
        slug: z.string().min(1).max(120).optional(),
      })
    )
    .max(10),
  hasMore: z.boolean(),
})

export type AdminAuditLookupResponse = z.infer<typeof adminAuditLookupResponseSchema>
