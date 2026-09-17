const one = (path, extra = {}) => ({ path, kind: 'file', cardinality: 'one', ...extra })
const dir = (path) => ({ path, kind: 'directory', cardinality: 'one' })
const many = (glob, extra = {}) => ({
  glob,
  kind: 'file',
  cardinality: 'one-or-more',
  ...extra,
})

const sharedModules = [
  'packages/shared/src/lib/frontend-url.ts',
  'apps/web/messages/en.json',
  'apps/web/messages/ru.json',
  'apps/web/src/i18n/request.ts',
  'apps/web/src/proxy.ts',
  'apps/web/src/i18n/routing.ts',
  'apps/web/src/i18n/navigation.ts',
  'apps/web/src/i18n/params.ts',
].map(one)

const linkedTests = [
  ['packages/shared/src/lib/frontend-url.test.ts', 'packages/shared/src/lib/frontend-url.ts'],
].map(([path, module]) => one(path, { module }))

const e2eVerification = [
  'apps/api/test/oauth.e2e-spec.ts',
  'apps/web/e2e/console-real-stack/session-isolation.spec.ts',
  'apps/web/e2e/mocked/accessibility.spec.ts',
  'apps/web/e2e/mocked/api-error-rendering.spec.ts',
  'apps/web/e2e/mocked/csp-nonce.spec.ts',
  'apps/web/e2e/mocked/csp-report-endpoint.spec.ts',
  'apps/web/e2e/mocked/login-validation.spec.ts',
  'apps/web/e2e/mocked/route-progress-bar.spec.ts',
  'apps/web/e2e/mocked/security-headers.spec.ts',
  'apps/web/e2e/mocked/theme-persistence.spec.ts',
  'apps/web/e2e/real-stack/accessibility.spec.ts',
  'apps/web/e2e/real-stack/app-shell.spec.ts',
  'apps/web/e2e/real-stack/auth-email-link-flows.spec.ts',
  'apps/web/e2e/real-stack/csp-nonce.spec.ts',
  'apps/web/e2e/real-stack/helpers.ts',
  'apps/web/e2e/real-stack/login.spec.ts',
  'apps/web/e2e/real-stack/register-and-logout.spec.ts',
  'apps/web/e2e/real-stack/require-session-redirect.spec.ts',
  'apps/web/e2e/real-stack/sessions.spec.ts',
  'apps/web/e2e/server-mocked/oauth-visibility.spec.ts',
].map((path) => one(path, { disposition: 'rewrite' }))

const localeOnlyVerification = [
  'apps/web/e2e/mocked/locale-redirect.spec.ts',
  'apps/web/e2e/real-stack/locale-persistence.spec.ts',
].map((path) => one(path, { disposition: 'delete' }))

const independentConsumers = [
  'apps/api/src/core/auth/auth.service.ts',
  'apps/api/src/core/auth/oauth/oauth.controller.ts',
  'apps/api/src/core/notifications/channels/email-channel.deliverer.ts',
  'apps/api/src/core/notifications/channels/telegram/telegram-channel.deliverer.ts',
  'apps/api/src/core/organizations/invite.service.ts',
].map(one)

const topology = [
  '(auth)/layout.tsx',
  '(auth)/forgot-password/page.tsx',
  '(auth)/login/page.tsx',
  '(auth)/register/page.tsx',
  '(auth)/resend-verification/page.tsx',
  '(auth)/reset-password/page.tsx',
  '(auth)/verify-email/page.tsx',
  '(dashboard)/error.tsx',
  '(dashboard)/layout.tsx',
  '(dashboard)/page.tsx',
  '(dashboard)/settings/sessions/page.tsx',
  'auth/callback/route.ts',
  'layout.tsx',
  'providers.tsx',
].map((path) => one(`apps/web/src/app/[locale]/${path}`))

export const localeOwnershipFacts = {
  roots: [dir('apps/web/src/features/locale-switcher')],
  featureFiles: [],
  sharedModules,
  sharedModuleTests: linkedTests,
  topology,
  verification: [...e2eVerification, ...localeOnlyVerification],
  documentation: [],
  featureEntrypoints: [],
  repositoryEntrypoints: [
    one('apps/api/src/main.ts'),
    ...independentConsumers,
    one('packages/shared/src/index.ts'),
    one('packages/shared/src/lib/frontend-url.ts'),
    one('apps/web/src/i18n/request.ts'),
    one('apps/web/src/proxy.ts'),
    many('apps/web/src/app/**/page.tsx'),
    many('apps/web/src/app/**/layout.tsx'),
    many('apps/web/src/app/**/route.ts'),
  ],
}

export const localeSurfaceRoots = [
  'apps/api/prisma/user.prisma',
  'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql',
  'apps/api/test/auth.e2e-spec.ts',
  'apps/api/test/oauth.e2e-spec.ts',
  'apps/api/src',
  'apps/web/eslint.config.mjs',
  'apps/web/messages',
  'apps/web/e2e',
  'apps/web/src',
  'packages/shared/src',
  'PROJECT_CONTEXT.md',
]
