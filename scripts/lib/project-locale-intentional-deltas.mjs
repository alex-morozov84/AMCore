const REQUEST = 'apps/web/src/i18n/request.ts'

const RU_ONLY = [
  'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
  'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts',
  'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts',
  'packages/shared/src/lib/frontend-url.test.ts',
  'apps/api/src/core/auth/auth.controller.spec.ts',
  'apps/api/src/core/auth/auth.service.spec.ts',
  'apps/api/src/core/notifications/channels/telegram/telegram-content.spec.ts',
  'apps/api/src/core/notifications/notification-definition.registry.spec.ts',
  'apps/api/src/core/notifications/definitions/account-password-changed.definition.ts',
  'apps/api/src/core/notifications/definitions/account-profile-updated.definition.ts',
  'apps/api/src/core/notifications/definitions/account-telegram-linked.definition.ts',
  'apps/api/src/core/organizations/invite.service.spec.ts',
  'apps/api/src/core/notifications/notification-feed.service.spec.ts',
]

export function localeIntentionalDeltas(locale) {
  return locale === 'ru' ? [REQUEST, ...RU_ONLY] : [REQUEST]
}
