import { messageSuite } from './project-locale-api-message-suite-operation.mjs'
import { notificationSuite } from './project-locale-api-notification-suite-operation.mjs'
import { claim, localeParams } from './project-locale-ast-helpers.mjs'

const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  ['messages', 'notification'].includes(params.variant)

export function registerLocaleApiSuiteOperation(registry) {
  registry.define('locale.api-locale-suite', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:api-suite:${variant}:locale`, locale),
    ],
    adapter: (model, params, ctx) =>
      params.variant === 'messages'
        ? messageSuite(model, params, ctx)
        : notificationSuite(model, params, ctx),
  })
}
