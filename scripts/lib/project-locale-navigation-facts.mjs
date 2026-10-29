import { localeContent } from './project-locale-fact-helpers.mjs'

const facts = {
  'locale.navigation-mfa': [
    'apps/web/src/_app/account-security/ui/client.tsx',
    'apps/web/src/_app/account-security/ui/sign-in-again-client.tsx',
    'apps/web/src/_app/console-account-security/ui/client.tsx',
  ],
  'locale.navigation-mfa-redirect': ['apps/web/src/_app/console-account-security/index.tsx'],
  'locale.navigation-admin-login': ['apps/web/src/_app/product-admin/ui/login-form.tsx'],
  'locale.navigation-selected-redirect': [
    'apps/web/src/_app/auth-completion/index.tsx',
    'apps/web/src/_app/product-admin/server/admission.ts',
    'apps/web/src/_app/product-admin/server/login-page.tsx',
  ],
  'locale.navigation-call': [
    'apps/web/src/features/auth-login/model/use-login.ts',
    'apps/web/src/features/auth-register/model/use-register.ts',
  ],
  'locale.navigation-dal': ['apps/web/src/shared/api/bff/dal.ts'],
  'locale.navigation-switcher': [
    'apps/web/src/_pages/account-security/index.tsx',
    'apps/web/src/widgets/app-shell/ui/AppShell.tsx',
    'apps/web/src/_pages/auth/AuthFrame.tsx',
  ],
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
    'apps/web/src/_app/organization-access/ui/navigation-entry.tsx',
    'apps/web/src/widgets/own-api-keys/ui/own-api-keys-host.tsx',
    'apps/web/src/widgets/console-shell/ui/ConsoleNavigation.tsx',
    'apps/web/src/widgets/console-shell/ui/ConsoleBreadcrumb.tsx',
    'apps/web/src/shared/ui/console-detail/ConsoleContextLink.tsx',
    'apps/web/src/shared/ui/console-detail/ConsoleRestorePosition.tsx',
  ],
}

export function buildLocaleNavigationFacts(locale) {
  const tests = [
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
