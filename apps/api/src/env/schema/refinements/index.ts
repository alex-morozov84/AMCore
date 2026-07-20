import type { EnvResolved } from './derive-defaults'
import { providerRules } from './provider-rules'
import type { RefinementCtx } from './refinement-ctx'
import { resourceRules } from './resource-rules'

export { deriveConditionalDefaults } from './derive-defaults'
export { injectWebhookSecrets } from './webhook-secrets'

// Cross-field rules that span domains (providers + resources). They run after
// `deriveConditionalDefaults`, so they see resolved values such as STORAGE_DRIVER.
export function crossFieldRules(env: EnvResolved, ctx: RefinementCtx): void {
  providerRules(env, ctx)
  resourceRules(env, ctx)
}
