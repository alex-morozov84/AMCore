import { operationsConsoleFacts } from './operations-console-ownership-facts.mjs'
import { buildLocaleCoreFacts } from './project-locale-core-facts.mjs'
import { buildLocaleApiSuiteFacts } from './project-locale-api-suite-facts.mjs'
import { buildLocaleApiFixtureFacts } from './project-locale-api-fixture-facts.mjs'
import { buildLocaleEmailTestFacts } from './project-locale-email-test-facts.mjs'
import { buildLocaleNavigationFacts } from './project-locale-navigation-facts.mjs'
import { buildLocaleNotificationFacts } from './project-locale-notification-facts.mjs'
import { buildLocaleRouteFacts } from './project-locale-route-facts.mjs'
import { buildLocaleWebTestFacts } from './project-locale-web-test-facts.mjs'
import { buildLocaleE2eRouteFacts } from './project-locale-e2e-route-facts.mjs'
import { buildLocaleE2eUiFacts } from './project-locale-e2e-ui-facts.mjs'

export function buildProjectLocaleFacts(state) {
  if (!state.selected.locale) return []
  const locale = state.locale.base
  const facts = [
    ...buildLocaleCoreFacts(locale),
    ...buildLocaleApiSuiteFacts(locale),
    ...buildLocaleApiFixtureFacts(locale),
    ...buildLocaleEmailTestFacts(locale),
    ...buildLocaleNotificationFacts(locale),
    ...buildLocaleRouteFacts(locale),
    ...buildLocaleNavigationFacts(locale),
    ...buildLocaleWebTestFacts(locale),
    ...buildLocaleE2eRouteFacts(locale),
    ...buildLocaleE2eUiFacts(locale),
  ].filter((fact) => !(state.storybook === 'disabled' && fact.path?.includes('.stories.')))
  if (state.adminConsole?.enabled !== false) return facts
  const removed = operationsConsoleFacts.verification
  return facts.filter(
    (fact) => !removed.some(({ path }) => fact.path === path || fact.path?.startsWith(`${path}/`))
  )
}
