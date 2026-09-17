import {
  E2E_ROUTE_SURFACES,
  LOCALE_ONLY_E2E_PATHS,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'

const REQUEST = 'apps/web/src/i18n/request.ts'

const SINGLE_LOCALE = [
  REQUEST,
  'packages/shared/src/schemas/auth.test.ts',
  'apps/api/test/auth.e2e-spec.ts',
  'apps/web/src/proxy.ts',
  ...E2E_ROUTE_SURFACES.map(([path]) => path),
  ...LOCALE_ONLY_E2E_PATHS,
  OAUTH_E2E_ROUTE_SURFACE[0],
]

const RU_ONLY = [
  'apps/api/prisma/user.prisma',
  'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql',
  'apps/api/src/core/auth/locale-negotiation.spec.ts',
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
  return locale === 'ru' ? [...SINGLE_LOCALE, ...RU_ONLY] : SINGLE_LOCALE
}
