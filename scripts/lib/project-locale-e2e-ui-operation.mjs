import { claim } from './project-locale-ast-helpers.mjs'
import { e2eUiExpectationInventory } from './project-locale-e2e-ui-inventory.mjs'
import { E2E_UI_PROFILES } from './project-locale-e2e-ui-surfaces.mjs'

const supportedNamespaces = new Set(Object.keys(E2E_UI_PROFILES))

const paramsSchema = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 3 &&
  ['en', 'ru'].includes(params.locale) &&
  Number.isInteger(params.expectedReferences) &&
  params.expectedReferences > 0 &&
  Array.isArray(params.namespaces) &&
  params.namespaces.length > 0 &&
  new Set(params.namespaces).size === params.namespaces.length &&
  params.namespaces.every((value) => supportedNamespaces.has(value))

function adaptE2eUi(model, params, ctx) {
  const inventory = e2eUiExpectationInventory(model, params.namespaces)
  if (inventory.count !== params.expectedReferences) {
    throw new Error(
      `${ctx.operationKey}: expected ${params.expectedReferences} localized UI expectations, found ${inventory.count}`
    )
  }
  if (params.locale === 'en') return
  for (const reference of inventory.references) {
    model.replaceNode(reference.node, reference.replacement, ctx)
  }
}

export function registerLocaleE2eUiOperation(registry) {
  registry.define('locale.e2e-ui-expectations', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, namespaces, expectedReferences }) => [
      claim('ts:e2e-ui:selected-catalogue', locale),
      claim('ts:e2e-ui:namespaces', namespaces),
      claim('ts:e2e-ui:expectation-count', expectedReferences),
    ],
    adapter: adaptE2eUi,
  })
}
