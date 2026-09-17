import { localeContent } from './project-locale-fact-helpers.mjs'

export function buildLocaleCoreFacts(locale) {
  return [
    localeContent('packages/shared/src/constants/index.ts', 'locale.supported-locales', locale),
    localeContent(
      'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql',
      'locale.sql-user-default',
      locale
    ),
    localeContent('apps/api/prisma/user.prisma', 'locale.prisma-user-default', locale),
    localeContent(
      'apps/api/src/core/auth/locale-negotiation.spec.ts',
      'locale.database-default-test',
      locale,
      { variant: 'negotiation-unit' }
    ),
    localeContent('apps/api/test/auth.e2e-spec.ts', 'locale.database-default-test', locale, {
      variant: 'auth-e2e',
    }),
    localeContent('apps/api/test/oauth.e2e-spec.ts', 'locale.database-default-test', locale, {
      variant: 'oauth-e2e',
    }),
    localeContent(
      'packages/shared/src/schemas/auth.test.ts',
      'locale.supported-schema-test',
      locale
    ),
    localeContent(
      'packages/shared/src/lib/frontend-url.test.ts',
      'locale.frontend-url-test',
      locale
    ),
    localeContent(
      'apps/api/src/core/notifications/channels/telegram/telegram-messages.ts',
      'locale.message-map',
      locale
    ),
    localeContent('apps/api/src/infrastructure/email/messages.ts', 'locale.message-map', locale),
    localeContent('apps/web/src/i18n/request.ts', 'locale.request-config', locale),
    localeContent('apps/web/src/proxy.ts', 'locale.proxy-i18n-seam', locale, {
      topology: 'single-unprefixed',
    }),
    localeContent('apps/web/src/global.d.ts', 'locale.global-types', locale),
    localeContent('apps/web/src/i18n/messages.test.ts', 'locale.web-messages-test', locale),
  ]
}
