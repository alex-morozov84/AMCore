import { z } from 'zod'

/** Account signup and organization creation are independent deployment policies. */
export const organizationsEnv = z.object({
  ORG_SELF_SERVICE_CREATION_ENABLED: z.stringbool().default(true),
})
