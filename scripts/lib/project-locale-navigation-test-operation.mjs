import { absent, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  rewriteEslintGuards,
  rewriteOAuthTest,
  rewriteOptionalDalTest,
  rewriteRouterTest,
} from './project-locale-navigation-test-core.mjs'
import {
  rewriteBarTest,
  rewriteGatingTest,
  rewriteLinkTest,
} from './project-locale-navigation-mock-tests.mjs'

const adapters = {
  oauth: rewriteOAuthTest,
  eslint: rewriteEslintGuards,
  gating: rewriteGatingTest,
  optional: rewriteOptionalDalTest,
  router: rewriteRouterTest,
  link: rewriteLinkTest,
  bar: rewriteBarTest,
}

const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  Object.keys(params).length === 2 &&
  Object.hasOwn(adapters, params.variant)

function navigationTest(model, { variant }, ctx) {
  adapters[variant](model, ctx)
}

export function registerLocaleNavigationTestOperation(registry) {
  registry.define('locale.navigation-test', {
    paramsSchema,
    deriveSemanticWrites: ({ variant }) => [
      claim(`ts:navigation-test:${variant}:topology`, 'unprefixed'),
      absent(`ts:navigation-test:${variant}:locale-helper`),
    ],
    adapter: navigationTest,
  })
}
