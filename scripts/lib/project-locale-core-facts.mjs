import { localeContent } from './project-locale-fact-helpers.mjs'

export function buildLocaleCoreFacts(locale) {
  return [
    localeContent('packages/shared/src/constants/index.ts', 'locale.supported-locales', locale),
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
    localeContent('apps/web/src/global.d.ts', 'locale.global-types', locale),
    localeContent('apps/web/src/i18n/messages.test.ts', 'locale.web-messages-test', locale),
  ]
}
