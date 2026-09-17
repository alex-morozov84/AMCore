import { localeContent } from './project-locale-fact-helpers.mjs'

const simple = [
  'apps/api/src/core/auth/auth.controller.spec.ts',
  'apps/api/src/core/admin/admin.service.spec.ts',
  'apps/api/src/core/auth/session.service.spec.ts',
  'apps/api/src/core/auth/user-cache.service.spec.ts',
  'apps/api/src/core/notifications/notifications.service.spec.ts',
]

const fixtures = [
  ['apps/api/src/core/auth/oauth/oauth.service.spec.ts', 'locale.api-fixture', 'all-locales'],
  [
    'apps/api/src/core/notifications/channels/email-channel.deliverer.spec.ts',
    'locale.api-link-fixture',
    'email',
  ],
  ['apps/api/src/core/organizations/invite.service.spec.ts', 'locale.api-link-fixture', 'invite'],
  [
    'apps/api/src/core/notifications/channels/telegram/telegram-channel.deliverer.spec.ts',
    'locale.api-link-fixture',
    'telegram',
  ],
  [
    'apps/api/src/core/notifications/definitions/account-password-changed.definition.spec.ts',
    'locale.api-fixture',
    'password-definition',
  ],
  [
    'apps/api/src/core/notifications/notification-definition.registry.spec.ts',
    'locale.api-fixture',
    'definition-registry',
  ],
]

export function buildLocaleApiFixtureFacts(locale) {
  return [
    ...simple.map((pathname) =>
      localeContent(pathname, 'locale.api-fixture', locale, { variant: 'simple' })
    ),
    localeContent(
      'apps/api/src/core/auth/auth.service.spec.ts',
      'locale.auth-service-test',
      locale
    ),
    localeContent(
      'apps/api/src/core/auth/auth.controller.spec.ts',
      'locale.auth-controller-typed-fixture',
      locale
    ),
    localeContent(
      'apps/api/src/core/notifications/channels/telegram/telegram-content.spec.ts',
      'locale.telegram-content-test',
      locale
    ),
    localeContent(
      'apps/api/src/core/notifications/notification-feed.service.spec.ts',
      'locale.notification-feed-test',
      locale
    ),
    ...fixtures.map(([pathname, operationKey, variant]) =>
      localeContent(pathname, operationKey, locale, { variant })
    ),
  ]
}
