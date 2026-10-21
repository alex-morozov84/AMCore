import { absent, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  dropLocalePushOption,
  dropAdminLoginLocale,
  rewriteDal,
  rewriteOAuth,
  rewriteSelectedRedirect,
} from './project-locale-navigation-core.mjs'
import {
  removeConsoleLocaleSwitcher,
  removeLocaleSwitcher,
  rewriteNavigationAdapter,
  rewritePlainPathnameAdapter,
} from './project-locale-navigation-ui.mjs'

const definitions = [
  [
    'locale.navigation-admin-login',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [absent('ts:admin-login:locale-navigation-option')],
      adapter: dropAdminLoginLocale,
    },
  ],
  [
    'locale.navigation-selected-redirect',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [claim('ts:selected-redirect:source', 'next/navigation')],
      adapter: rewriteSelectedRedirect,
    },
  ],
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
  [
    'locale.navigation-console-switcher',
    {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [absent('ts:ConsoleLocaleSwitcher:import-and-render')],
      adapter: removeConsoleLocaleSwitcher,
    },
  ],
]

export function registerLocaleNavigationOperations(registry) {
  for (const [key, definition] of definitions) registry.define(key, definition)
}
