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

export function registerProjectLocaleOperations(registry) {
  registerLocaleApiSuiteOperation(registry)
  registerLocaleApiFixtureOperations(registry)
  registerLocaleAuthServiceOperation(registry)
  registerLocaleApiLinkOperation(registry)
  registerLocaleConfigOperations(registry)
  registerLocaleEmailTestOperation(registry)
  registerLocaleGlobalTypesOperation(registry)
  registerLocaleNavigationOperations(registry)
  registerLocaleRequestOperation(registry)
  registerLocaleRootLayoutOperation(registry)
  registerLocaleRouteOperations(registry)
  registerLocaleWebSuiteOperations(registry)
  registerLocaleWebMessagesOperation(registry)
  registerLocaleWelcomeTestOperation(registry)
  registerLocaleRenderOperation(registry)
  registerLocaleFrontendUrlOperation(registry)
  registerLocaleNavigationTestOperation(registry)
}
