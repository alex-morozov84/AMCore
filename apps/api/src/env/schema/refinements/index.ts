import type { EnvResolved } from './derive-defaults.js'
import { providerRules } from './provider-rules.js'
import type { RefinementCtx } from './refinement-ctx.js'
import { resourceRules } from './resource-rules.js'

export { deriveConditionalDefaults } from './derive-defaults.js'
export { injectWebhookSecrets } from './webhook-secrets.js'

// Cross-field rules that span domains (providers + resources). They run after
// `deriveConditionalDefaults`, so they see resolved values such as STORAGE_DRIVER.
export function crossFieldRules(env: EnvResolved, ctx: RefinementCtx): void {
  providerRules(env, ctx)
  resourceRules(env, ctx)
}
