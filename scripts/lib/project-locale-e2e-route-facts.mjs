import { localeContent, localeDelete } from './project-locale-fact-helpers.mjs'
import {
  E2E_ROUTE_SURFACES,
  LOCALE_ONLY_E2E_PATHS,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'

export function buildLocaleE2eRouteFacts(locale) {
  const shared = E2E_ROUTE_SURFACES.map(([path, expectedReferences, unavailableUiCases = 0]) =>
    localeContent(path, 'locale.e2e-route-topology', locale, {
      surface: 'web',
      expectedReferences,
      unavailableUiCases,
    })
  )
  const [oauthPath, expectedReferences] = OAUTH_E2E_ROUTE_SURFACE
  return [
    ...shared,
    localeContent(oauthPath, 'locale.e2e-route-topology', locale, {
      surface: 'oauth',
      expectedReferences,
      unavailableUiCases: 0,
    }),
    ...LOCALE_ONLY_E2E_PATHS.map(localeDelete),
  ]
}
