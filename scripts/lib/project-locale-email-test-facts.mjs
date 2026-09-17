import { localeContent } from './project-locale-fact-helpers.mjs'

const templates = [
  ['email-verification', 'verification'],
  ['org-invite', 'invite'],
  ['password-reset', 'reset'],
]

export function buildLocaleEmailTestFacts(locale) {
  return [
    ...templates.map(([file, template]) =>
      localeContent(
        `apps/api/src/infrastructure/email/templates/${file}.integration.spec.ts`,
        'locale.email-template-test',
        locale,
        { template }
      )
    ),
    localeContent(
      'apps/api/src/infrastructure/email/templates/welcome.integration.spec.ts',
      'locale.welcome-email-test',
      locale
    ),
    localeContent(
      'apps/api/src/infrastructure/email/templates/render-robustness.integration.spec.ts',
      'locale.render-robustness-test',
      locale
    ),
  ]
}
