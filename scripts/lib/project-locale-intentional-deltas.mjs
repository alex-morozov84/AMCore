const REQUEST = 'apps/web/src/i18n/request.ts'

const RU_ONLY = [
  'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts',
  'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts',
  'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts',
  'packages/shared/src/lib/frontend-url.test.ts',
]

export function localeIntentionalDeltas(locale) {
  return locale === 'ru' ? [REQUEST, ...RU_ONLY] : [REQUEST]
}
