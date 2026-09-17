import { localeParams } from './project-locale-ast-helpers.mjs'
import { localeRequestClaims, requestConfig } from './project-locale-config-operations.mjs'

export function registerLocaleRequestOperation(registry) {
  registry.define('locale.request-config', {
    paramsSchema: localeParams,
    deriveSemanticWrites: localeRequestClaims,
    adapter: requestConfig,
  })
}
