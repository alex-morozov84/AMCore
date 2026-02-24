import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
