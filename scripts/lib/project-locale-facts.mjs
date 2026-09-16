import { buildLocaleCoreFacts } from './project-locale-core-facts.mjs'
import { buildLocaleApiSuiteFacts } from './project-locale-api-suite-facts.mjs'
import { buildLocaleApiFixtureFacts } from './project-locale-api-fixture-facts.mjs'
import { buildLocaleEmailTestFacts } from './project-locale-email-test-facts.mjs'
import { buildLocaleNavigationFacts } from './project-locale-navigation-facts.mjs'
import { buildLocaleNotificationFacts } from './project-locale-notification-facts.mjs'
import { buildLocaleRouteFacts } from './project-locale-route-facts.mjs'
import { buildLocaleWebTestFacts } from './project-locale-web-test-facts.mjs'

export function buildProjectLocaleFacts(state) {
  if (!state.selected.locale) return []
  const locale = state.locale.base
  return [
    ...buildLocaleCoreFacts(locale),
    ...buildLocaleApiSuiteFacts(locale),
    ...buildLocaleApiFixtureFacts(locale),
    ...buildLocaleEmailTestFacts(locale),
    ...buildLocaleNotificationFacts(locale),
    ...buildLocaleRouteFacts(locale),
    ...buildLocaleNavigationFacts(locale),
    ...buildLocaleWebTestFacts(locale),
  ]
}
