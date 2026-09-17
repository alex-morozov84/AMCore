import { localeContent } from './project-locale-fact-helpers.mjs'
import { E2E_UI_SURFACES } from './project-locale-e2e-ui-surfaces.mjs'

export function buildLocaleE2eUiFacts(locale) {
  return E2E_UI_SURFACES.map(({ path, namespaces, expectedReferences }) =>
    localeContent(path, 'locale.e2e-ui-expectations', locale, {
      namespaces,
      expectedReferences,
    })
  )
}
