import { localeContent } from './project-locale-fact-helpers.mjs'

const catalogueFixtures = [
  ['apps/web/src/shared/api/error-messages.test.ts', 'errors'],
  ['apps/web/src/_pages/settings/SessionsPage/SessionsTable.test.tsx', 'sessions'],
  ['apps/web/src/features/auth-oauth/ui/OAuthSection.test.tsx', 'oauth'],
  ['apps/web/src/shared/ui/section-error-boundary.test.tsx', 'section'],
]

const localeSuites = [
  ['apps/web/src/features/auth-oauth/ui/OAuthErrorAlert.test.tsx', 'oauth-alert'],
  ['apps/web/src/shared/lib/zod-error-map.test.tsx', 'zod'],
  ['apps/web/src/shared/ui/api-error-alert.test.tsx', 'api-alert'],
  ['apps/web/src/shared/ui/primary-unavailable-fallback.test.tsx', 'fallback'],
]

export function buildLocaleWebTestFacts(locale) {
  return [
    ...catalogueFixtures.map(([pathname, variant]) =>
      localeContent(pathname, 'locale.catalogue-fixture', locale, { variant })
    ),
    ...localeSuites.map(([pathname, variant]) =>
      localeContent(pathname, 'locale.web-locale-suite', locale, { variant })
    ),
  ]
}
