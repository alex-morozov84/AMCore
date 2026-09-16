import { localeContent } from './project-locale-fact-helpers.mjs'

export function buildLocaleApiSuiteFacts(locale) {
  return [
    localeContent(
      'apps/api/src/infrastructure/email/messages.spec.ts',
      'locale.api-locale-suite',
      locale,
      { variant: 'messages' }
    ),
    localeContent(
      'apps/api/src/infrastructure/email/templates/notification.integration.spec.ts',
      'locale.api-locale-suite',
      locale,
      { variant: 'notification' }
    ),
  ]
}
