import { z } from 'zod'

import { optionalEnvString } from './helpers.js'

export const productAdminEnv = z.object({
  PRODUCT_ADMIN_ORIGIN: optionalEnvString(),
  // API-only clients need no BFF key; a supplied key is always validated.
  // apps/web requires it and the API rejects every unproved context selection.
  WEB_FRONTEND_CONTEXT_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional()
  ),
})
