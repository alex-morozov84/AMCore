import { registerLocaleConfigOperations } from './project-locale-config-operations.mjs'
import { registerLocaleApiSuiteOperation } from './project-locale-api-suite-operation.mjs'
import { registerLocaleApiFixtureOperations } from './project-locale-api-fixture-operations.mjs'
import { registerLocaleAuthServiceOperation } from './project-locale-auth-service-operation.mjs'
import { registerLocaleApiLinkOperation } from './project-locale-api-link-operation.mjs'
import { registerLocaleEmailTestOperation } from './project-locale-email-test-operation.mjs'
import { registerLocaleGlobalTypesOperation } from './project-locale-global-types-operation.mjs'
import { registerLocaleNavigationOperations } from './project-locale-navigation-operations.mjs'
import { registerLocaleRequestOperation } from './project-locale-request-operation.mjs'
import { registerLocaleRootLayoutOperation } from './project-locale-root-layout-operation.mjs'
import { registerLocaleRouteOperations } from './project-locale-route-operations.mjs'
import { registerLocaleWebSuiteOperations } from './project-locale-web-suite-operations.mjs'
import { registerLocaleWebMessagesOperation } from './project-locale-web-messages-operation.mjs'
import { registerLocaleWelcomeTestOperation } from './project-locale-welcome-test-operation.mjs'
import { registerLocaleRenderOperation } from './project-locale-render-operation.mjs'
import { registerLocaleFrontendUrlOperation } from './project-locale-frontend-url-operation.mjs'
import { registerLocaleNavigationTestOperation } from './project-locale-navigation-test-operation.mjs'
import { registerLocaleAuthControllerOperation } from './project-locale-auth-controller-operation.mjs'
import { registerLocaleNotificationDefinitionOperation } from './project-locale-notification-definition-operation.mjs'
import { registerLocaleTelegramContentOperation } from './project-locale-telegram-content-operation.mjs'
import { registerLocaleNotificationFeedOperation } from './project-locale-notification-feed-operation.mjs'
import { registerLocaleSupportedSchemaOperation } from './project-locale-supported-schema-operation.mjs'
import { registerLocaleDatabaseTestOperation } from './project-locale-database-test-operation.mjs'
import { registerLocaleE2eRouteOperation } from './project-locale-e2e-route-operation.mjs'
import { registerLocaleProxyOperation } from './project-locale-proxy-operation.mjs'
import { registerLocaleE2eUiOperation } from './project-locale-e2e-ui-operation.mjs'

export function registerProjectLocaleOperations(registry) {
  registerLocaleApiSuiteOperation(registry)
  registerLocaleApiFixtureOperations(registry)
  registerLocaleAuthServiceOperation(registry)
  registerLocaleAuthControllerOperation(registry)
  registerLocaleApiLinkOperation(registry)
  registerLocaleConfigOperations(registry)
  registerLocaleEmailTestOperation(registry)
  registerLocaleGlobalTypesOperation(registry)
  registerLocaleNavigationOperations(registry)
  registerLocaleRequestOperation(registry)
  registerLocaleRootLayoutOperation(registry)
  registerLocaleSupportedSchemaOperation(registry)
  registerLocaleDatabaseTestOperation(registry)
  registerLocaleE2eRouteOperation(registry)
  registerLocaleProxyOperation(registry)
  registerLocaleE2eUiOperation(registry)
  registerLocaleRouteOperations(registry)
  registerLocaleWebSuiteOperations(registry)
  registerLocaleWebMessagesOperation(registry)
  registerLocaleWelcomeTestOperation(registry)
  registerLocaleRenderOperation(registry)
  registerLocaleFrontendUrlOperation(registry)
  registerLocaleNavigationTestOperation(registry)
  registerLocaleNotificationDefinitionOperation(registry)
  registerLocaleNotificationFeedOperation(registry)
  registerLocaleTelegramContentOperation(registry)
}
