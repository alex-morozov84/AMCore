import { localeContent } from './project-locale-fact-helpers.mjs'

const facts = {
  'locale.navigation-call': [
    'apps/web/src/features/auth-login/model/use-login.ts',
    'apps/web/src/features/auth-register/model/use-register.ts',
  ],
  'locale.navigation-dal': ['apps/web/src/shared/api/bff/dal.ts'],
  'locale.navigation-oauth': ['apps/web/src/shared/api/bff/oauth-exchange-handler.ts'],
  'locale.navigation-switcher': ['apps/web/src/widgets/app-shell/ui/AppShell.tsx'],
  // Same removal shape as locale.navigation-switcher, applied to the
  // console shell's own switcher instead of the product AppShell's.
  'locale.navigation-console-switcher': ['apps/web/src/widgets/console-shell/ui/ConsoleShell.tsx'],
  'locale.navigation-adapter': [
    'apps/web/src/shared/lib/route-progress/use-route-progress-router.ts',
    'apps/web/src/shared/ui/route-progress-link.tsx',
    'apps/web/src/shared/ui/route-progress-bar.tsx',
  ],
  // Import only `usePathname`, nothing else - a plain adapter swap, not the
  // file-specific `locale.navigation-adapter` branches above.
  'locale.navigation-plain-pathname': [
    'apps/web/src/widgets/console-shell/ui/ConsoleNavigation.tsx',
    'apps/web/src/widgets/console-shell/ui/ConsoleBreadcrumb.tsx',
    'apps/web/src/shared/ui/console-detail/ConsoleContextLink.tsx',
    'apps/web/src/shared/ui/console-detail/ConsoleRestorePosition.tsx',
  ],
}

export function buildLocaleNavigationFacts(locale) {
  const tests = [
    ['apps/web/src/shared/api/bff/oauth-exchange-handler.test.ts', 'oauth'],
    ['apps/web/src/test/eslint-guards.test.ts', 'eslint'],
    ['apps/web/src/shared/api/bff/dal.gating.test.ts', 'gating'],
    ['apps/web/src/shared/api/bff/dal.optional-session.test.ts', 'optional'],
    ['apps/web/src/shared/lib/route-progress/use-route-progress-router.test.ts', 'router'],
    ['apps/web/src/shared/ui/route-progress-link.test.tsx', 'link'],
    ['apps/web/src/shared/ui/route-progress-bar.test.tsx', 'bar'],
  ]
  return [
    ...Object.entries(facts).flatMap(([operationKey, paths]) =>
      paths.map((pathname) => localeContent(pathname, operationKey, locale))
    ),
    ...tests.map(([pathname, variant]) =>
      localeContent(pathname, 'locale.navigation-test', locale, { variant })
    ),
  ]
}
