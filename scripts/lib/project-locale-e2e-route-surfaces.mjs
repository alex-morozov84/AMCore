export const LOCALE_ONLY_E2E_PATHS = [
  'apps/web/e2e/mocked/locale-redirect.spec.ts',
  'apps/web/e2e/mocked/locale-switcher.spec.ts',
  'apps/web/e2e/real-stack/locale-url.spec.ts',
  'apps/web/e2e/real-stack/auth-locale-profile.spec.ts',
  'apps/web/e2e/console-real-stack/locale-profile.spec.ts',
  'apps/web/e2e/shared/locale-switcher-journey.ts',
  'apps/web/e2e/shared/url-only-locale-journey.ts',
  'apps/web/e2e/real-stack/locale-persistence.spec.ts',
]

export const E2E_ROUTE_SURFACES = [
  ['apps/web/e2e/real-stack/admin-overview.spec.ts', 12, 1],
  ['apps/web/e2e/console-real-stack/overview.spec.ts', 11, 1],
  ['apps/web/e2e/shared/overview-summary-journey.ts', 11],
  ['apps/web/e2e/real-stack/admin-users.spec.ts', 16],
  ['apps/web/e2e/console-real-stack/users.spec.ts', 4],
  ['apps/web/e2e/product-admin-real-stack/product-admin-console-path.spec.ts', 2],
  ['apps/web/e2e/product-admin-real-stack/product-admin-denied-loss.spec.ts', 3],
  ['apps/web/e2e/product-admin-real-stack/product-admin-host.spec.ts', 5],
  ['apps/web/e2e/product-admin-real-stack/product-admin-invitation.spec.ts', 3],
  ['apps/web/e2e/product-admin-real-stack/product-admin-oauth-get.spec.ts', 6],
  ['apps/web/e2e/product-admin-real-stack/product-admin-oauth-surfaces.spec.ts', 3],
  ['apps/web/e2e/product-admin-real-stack/product-admin-oauth.spec.ts', 5],
  ['apps/web/e2e/product-admin-real-stack/product-admin-review-c2.spec.ts', 7],
  ['apps/web/e2e/real-stack/admin-background-work.spec.ts', 5, 0, ['/en']],
  ['apps/web/e2e/console-real-stack/background-work.spec.ts', 9, 0, ['/en']],
  // These routes use /en; /runtime-settings is an API path, not a /ru locale.
  ['apps/web/e2e/real-stack/storage-runtime-settings.spec.ts', 6, 0, ['/en']],
  ['apps/web/e2e/console-real-stack/storage-runtime-settings.spec.ts', 4, 0, ['/en']],
  ['apps/web/e2e/real-stack/admin-sessions/sessions.spec.ts', 6],
  ['apps/web/e2e/console-real-stack/sessions.spec.ts', 6],
  ['apps/web/e2e/console-real-stack/session-isolation.spec.ts', 5],
  ['apps/web/e2e/mocked/accessibility.spec.ts', 4],
  ['apps/web/e2e/mocked/api-error-rendering.spec.ts', 1],
  ['apps/web/e2e/mocked/csp-nonce.spec.ts', 8],
  ['apps/web/e2e/mocked/csp-report-endpoint.spec.ts', 2],
  ['apps/web/e2e/mocked/login-validation.spec.ts', 7],
  ['apps/web/e2e/mocked/route-progress-bar.spec.ts', 16, 1],
  ['apps/web/e2e/mocked/security-headers.spec.ts', 1],
  ['apps/web/e2e/mocked/theme-persistence.spec.ts', 3],
  ['apps/web/e2e/real-stack/accessibility.spec.ts', 4],
  ['apps/web/e2e/real-stack/app-shell.spec.ts', 3],
  ['apps/web/e2e/real-stack/auth-email-link-flows.spec.ts', 12],
  ['apps/web/e2e/real-stack/csp-nonce.spec.ts', 5],
  ['apps/web/e2e/real-stack/credential-containment.spec.ts', 3],
  ['apps/web/e2e/real-stack/helpers.ts', 3],
  ['apps/web/e2e/real-stack/login.spec.ts', 3],
  ['apps/web/e2e/real-stack/register-and-logout.spec.ts', 2],
  ['apps/web/e2e/real-stack/require-session-redirect.spec.ts', 4],
  ['apps/web/e2e/real-stack/sessions.spec.ts', 3],
  ['apps/web/e2e/server-mocked/oauth-visibility.spec.ts', 2],
  ['apps/web/e2e/real-stack/admin-sessions/readability.spec.ts', 3],
  ['apps/web/e2e/real-stack/sessions-readability.spec.ts', 3],
]

export const OAUTH_E2E_ROUTE_SURFACE = ['apps/api/test/oauth.e2e-spec.ts', 10]

export const E2E_ROUTE_DENOMINATOR =
  E2E_ROUTE_SURFACES.reduce((total, [, count]) => total + count, 0) +
  LOCALE_ONLY_E2E_PATHS.reduce((total, path) => {
    const counts = {
      'apps/web/e2e/mocked/locale-redirect.spec.ts': 4,
      'apps/web/e2e/real-stack/locale-persistence.spec.ts': 7,
      'apps/web/e2e/mocked/locale-switcher.spec.ts': 4,
      'apps/web/e2e/real-stack/locale-url.spec.ts': 0,
      'apps/web/e2e/real-stack/auth-locale-profile.spec.ts': 0,
      'apps/web/e2e/console-real-stack/locale-profile.spec.ts': 0,
      'apps/web/e2e/shared/locale-switcher-journey.ts': 0,
      'apps/web/e2e/shared/url-only-locale-journey.ts': 0,
    }
    return total + counts[path]
  }, OAUTH_E2E_ROUTE_SURFACE[1])
