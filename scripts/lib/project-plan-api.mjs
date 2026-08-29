// Aggregates every init:project --mode=single step under apps/api: fixing
// both typecheck (a narrowed SupportedLocale) and runtime test semantics (a
// trimmed SUPPORTED_LOCALES/emailMessages/telegramGenericMessages) across
// the specs the real `pnpm --filter api test` in init-project.test.mjs
// found broken — none of this was in PR3A's original survey, which only
// covered packages/shared and telegram-messages.ts.
import { buildApiLocaleFixturesSteps } from './project-plan-api-locale-fixtures.mjs'
import { buildApiFixtureLocalesSteps } from './project-plan-api-fixture-locales.mjs'
import { buildApiOauthServiceTestSteps } from './project-plan-api-oauth-service-test.mjs'
import { buildApiTelegramDelivererTestSteps } from './project-plan-api-telegram-deliverer-test.mjs'
import { buildApiLocaleNegotiationTestSteps } from './project-plan-api-locale-negotiation-test.mjs'
import { buildApiNotificationDefinitionTestSteps } from './project-plan-api-notification-definition-tests.mjs'
import { buildApiFrontendUrlTestSteps } from './project-plan-api-frontend-url-test.mjs'
import { buildApiEmailIntegrationTestsSteps } from './project-plan-api-email-integration-tests.mjs'
import { buildApiNotificationIntegrationTestSteps } from './project-plan-api-notification-integration-test.mjs'
import { buildApiWelcomeIntegrationTestSteps } from './project-plan-api-welcome-integration-test.mjs'
import { buildApiRenderRobustnessTestSteps } from './project-plan-api-render-robustness-test.mjs'
import { buildApiMessagesTestSteps } from './project-plan-api-messages-test.mjs'

export function buildApiLocaleSteps(root, locale) {
  return [
    ...buildApiLocaleFixturesSteps(root, locale),
    ...buildApiFixtureLocalesSteps(root, locale),
    ...buildApiOauthServiceTestSteps(root, locale),
    ...buildApiTelegramDelivererTestSteps(root, locale),
    ...buildApiLocaleNegotiationTestSteps(root, locale),
    ...buildApiNotificationDefinitionTestSteps(root, locale),
    ...buildApiFrontendUrlTestSteps(root),
    ...buildApiEmailIntegrationTestsSteps(root, locale),
    ...buildApiNotificationIntegrationTestSteps(root, locale),
    ...buildApiWelcomeIntegrationTestSteps(root, locale),
    ...buildApiRenderRobustnessTestSteps(root, locale),
    ...buildApiMessagesTestSteps(root, locale),
  ]
}
