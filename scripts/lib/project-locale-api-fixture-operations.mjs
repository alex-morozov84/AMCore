import { claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  normalizeLocaleLiterals,
  normalizeRussianFixtureLiterals,
  rewriteAuthServiceSpecialCase,
} from './project-locale-api-simple-fixtures.mjs'
import {
  rewritePasswordDefinition,
  rewriteRegistryDefinition,
} from './project-locale-api-definition-fixtures.mjs'

const variants = [
  'simple',
  'all-locales',
  'auth-service',
  'password-definition',
  'definition-registry',
]
const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  variants.includes(params.variant)

function apiFixture(model, { locale, variant }, ctx) {
  if (variant === 'password-definition') return rewritePasswordDefinition(model, locale, ctx)
  if (variant === 'definition-registry') return rewriteRegistryDefinition(model, locale, ctx)
  if (variant === 'simple') normalizeRussianFixtureLiterals(model, locale, ctx)
  else normalizeLocaleLiterals(model, locale, ctx)
  if (variant === 'auth-service') rewriteAuthServiceSpecialCase(model, ctx)
}

export function registerLocaleApiFixtureOperations(registry) {
  registry.define('locale.api-fixture', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, variant }) => [
      claim(`ts:api-fixture:${variant}:locale`, locale),
    ],
    adapter: apiFixture,
  })
}
