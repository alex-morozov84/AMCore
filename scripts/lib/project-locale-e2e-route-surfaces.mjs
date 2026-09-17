export const LOCALE_ONLY_E2E_PATHS = [
  'apps/web/e2e/mocked/locale-redirect.spec.ts',
  'apps/web/e2e/real-stack/locale-persistence.spec.ts',
]

export const E2E_ROUTE_SURFACES = [
  ['apps/web/e2e/console-real-stack/session-isolation.spec.ts', 5],
  ['apps/web/e2e/mocked/accessibility.spec.ts', 3],
  ['apps/web/e2e/mocked/api-error-rendering.spec.ts', 1],
  ['apps/web/e2e/mocked/csp-nonce.spec.ts', 8],
  ['apps/web/e2e/mocked/csp-report-endpoint.spec.ts', 2],
  ['apps/web/e2e/mocked/login-validation.spec.ts', 2],
  ['apps/web/e2e/mocked/route-progress-bar.spec.ts', 15, 1],
  ['apps/web/e2e/mocked/security-headers.spec.ts', 1],
  ['apps/web/e2e/mocked/theme-persistence.spec.ts', 3],
  ['apps/web/e2e/real-stack/accessibility.spec.ts', 4],
  ['apps/web/e2e/real-stack/app-shell.spec.ts', 3],
  ['apps/web/e2e/real-stack/auth-email-link-flows.spec.ts', 12],
  ['apps/web/e2e/real-stack/csp-nonce.spec.ts', 5],
  ['apps/web/e2e/real-stack/helpers.ts', 2],
  ['apps/web/e2e/real-stack/login.spec.ts', 3],
  ['apps/web/e2e/real-stack/register-and-logout.spec.ts', 2],
  ['apps/web/e2e/real-stack/require-session-redirect.spec.ts', 4],
  ['apps/web/e2e/real-stack/sessions.spec.ts', 3],
  ['apps/web/e2e/server-mocked/oauth-visibility.spec.ts', 2],
]

export const OAUTH_E2E_ROUTE_SURFACE = ['apps/api/test/oauth.e2e-spec.ts', 10]

export const E2E_ROUTE_DENOMINATOR =
  E2E_ROUTE_SURFACES.reduce((total, [, count]) => total + count, 0) +
  LOCALE_ONLY_E2E_PATHS.reduce((total, path) => {
    const counts = {
      'apps/web/e2e/mocked/locale-redirect.spec.ts': 4,
      'apps/web/e2e/real-stack/locale-persistence.spec.ts': 5,
    }
    return total + counts[path]
  }, OAUTH_E2E_ROUTE_SURFACE[1])
