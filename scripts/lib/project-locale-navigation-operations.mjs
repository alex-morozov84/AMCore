import { absent, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  dropLocalePushOption,
  rewriteDal,
  rewriteOAuth,
} from './project-locale-navigation-core.mjs'
import {
  removeLocaleSwitcher,
  rewriteNavigationAdapter,
  rewritePlainPathnameAdapter,
} from './project-locale-navigation-ui.mjs'

const definitions = [
  [
    'locale.navigation-call',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [absent('ts:navigation-call:locale-option')],
      adapter: dropLocalePushOption,
    },
  ],
  [
    'locale.navigation-dal',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [
        claim('ts:dal:redirect-source', 'next/navigation'),
        absent('ts:dal:locale-parameter'),
      ],
      adapter: rewriteDal,
    },
  ],
  [
    'locale.navigation-oauth',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [
        absent('ts:oauth-exchange:locale-parameter'),
        claim('ts:oauth-exchange:success-path', '/'),
        claim('ts:oauth-exchange:failure-path', '/login'),
      ],
      adapter: rewriteOAuth,
    },
  ],
  [
    'locale.navigation-adapter',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [claim('ts:navigation-adapter:source', 'next')],
      adapter: rewriteNavigationAdapter,
    },
  ],
  [
    'locale.navigation-plain-pathname',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [claim('ts:navigation-plain-pathname:source', 'next')],
      adapter: rewritePlainPathnameAdapter,
    },
  ],
  [
    'locale.navigation-switcher',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [absent('ts:LocaleSwitcher:import-and-render')],
      adapter: removeLocaleSwitcher,
    },
  ],
]

export function registerLocaleNavigationOperations(registry) {
  for (const [key, definition] of definitions) registry.define(key, definition)
}
