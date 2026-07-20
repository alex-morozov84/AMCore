import { z } from 'zod'

import { envBaseSchema } from './base'
import { crossFieldRules, deriveConditionalDefaults, injectWebhookSecrets } from './refinements'

// Full validation pipeline: inject dynamic webhook secrets → validate the flat
// domain-composed object → derive cross-field defaults → apply cross-field rules.
// Order matters: `deriveConditionalDefaults` runs before `crossFieldRules` so the
// rules see resolved values (e.g. STORAGE_DRIVER).
const envSchema = z
  .preprocess(injectWebhookSecrets, envBaseSchema)
  .transform(deriveConditionalDefaults)
  .superRefine(crossFieldRules)

export type Env = z.infer<typeof envSchema>

export function validate(config: Record<string, unknown>): Env {
  return envSchema.parse(config) as Env
}

// Re-exported for the `.env.example` coverage guard (introspects `.shape`).
export type { EnvInput } from './base'
export { envBaseSchema } from './base'
export { envSections } from './base'
