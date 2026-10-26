import { localeSeam } from './locale-ownership-seam.mjs'

export const localeCoreSeams = [
  ...[
    ['locale.route-cache-guide', 'AMCORE_LOCALE_ROUTE_CACHE_PATCH'],
    ['locale-console.route-cache-guide', 'AMCORE_CONSOLE_ROUTE_CACHE_PATCH'],
  ].map(([id, marker]) =>
    localeSeam(
      id,
      'docs/frontend/next-route-cache-patch.md',
      { start: `<!-- ${marker}_START -->`, end: `<!-- ${marker}_END -->` },
      [`${marker}_START`],
      id,
      { seamKind: 'owned-block', disposition: 'remove' }
    )
  ),
  localeSeam(
    'locale.lint-fixtures',
    'scripts/fixtures/lint/web.json',
    { text: '"name": "locale Link"' },
    ['locale-lint-fixtures'],
    'lint-fixtures-single-locale'
  ),
  localeSeam(
    'locale.proxy-i18n-seam',
    'apps/web/src/proxy.ts',
    { identifiers: ['next-intl/middleware', './i18n/routing', 'handleI18nRouting'] },
    ['next-intl/middleware', './i18n/routing', 'handleI18nRouting'],
    'locale.proxy-i18n-seam',
    { occurrences: 4 }
  ),
  localeSeam(
    'locale.prisma-user-default',
    'apps/api/prisma/user.prisma',
    { text: 'locale           String  @default("en")' },
    ['locale           String  @default("en")'],
    'locale.prisma-user-default'
  ),
  localeSeam(
    'locale.sql-user-default',
    'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql',
    { text: 'ALTER COLUMN "locale" SET DEFAULT \'en\'' },
    ['ALTER COLUMN "locale" SET DEFAULT \'en\''],
    'locale.sql-user-default'
  ),
  localeSeam(
    'locale.context',
    'PROJECT_CONTEXT.md',
    { identifiers: ['**i18n_mode:**', '**base_locale:**', '**supported_locales:**'] },
    ['locale-context'],
    'context-locale',
    { occurrences: 3 }
  ),
  localeSeam(
    'locale.eslint-navigation',
    'apps/web/eslint.config.mjs',
    { identifiers: ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'] },
    ['NAVIGATION_PATHS', 'project/import-guards-navigation-source'],
    'project-eslint-remove-navigation',
    { occurrences: 3, disposition: 'remove' }
  ),
  localeSeam(
    'locale.request-catalogue',
    'apps/web/src/i18n/request.ts',
    { text: '../../messages/${locale}.json' },
    ['dynamic-catalogue-import'],
    'locale.request-config',
    { disposition: 'remove' }
  ),
  localeSeam(
    'locale.supported-schema-test',
    'packages/shared/src/schemas/auth.test.ts',
    { identifiers: ['accepts supported locales and rejects others'] },
    ['accepts supported locales and rejects others'],
    'locale.supported-schema-test'
  ),
  // The URL-only reexport disappears with the locale feature it imports.
  localeSeam(
    'locale.console-switcher-deleted',
    'apps/web/src/widgets/console-shell/ui/ConsoleLocaleSwitcher.tsx',
    { identifiers: ['@/features/locale-switcher'] },
    ['feature-import'],
    'locale.navigation-console-switcher',
    { disposition: 'remove', removeImports: ['apps/web/src/features/locale-switcher/index.ts'] }
  ),
]
