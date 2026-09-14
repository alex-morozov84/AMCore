// Shared helpers for the real-file eslint.config.mjs composition tests
// (BACKLOG item 14, PR2/M2). Not a `.test.mjs` file, so importing it never
// re-registers another file's tests. Every assertion here re-parses the
// result and checks AST shape — none compares against copied source text.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  planStructuralComposition,
  applyStructuralPlan,
} from './path-algebra-structural-compose.mjs'
import {
  registerEslintFixtureOperations,
  ESLINT_CONFIG_PATH,
} from './path-algebra-eslint-fixture-operations.mjs'
import { parseStructuralModel, serializeStructuralModel } from './path-algebra-ast-model.mjs'
import {
  findUniqueNode,
  hasStringProperty,
  isImportOf,
  isStringLiteralText,
  isVariableStatementNamed,
  objectLiteralProperty,
} from './path-algebra-ast-query.mjs'
import { countNodes } from './path-algebra-test-helpers.mjs'

export const ESLINT_CONFIG_TEXT = readFileSync(
  new URL(`../../${ESLINT_CONFIG_PATH}`, import.meta.url),
  'utf8'
)

export const fact = (operationKey, dimension) => ({
  dimension,
  path: ESLINT_CONFIG_PATH,
  operationKey,
  params: {},
})
export const STORYBOOK = fact('remove-storybook-eslint', 'storybook')
export const NAVIGATION = fact('remove-navigation-ban-eslint', 'nav-guard')
export const MSW = fact('remove-msw-ignore-eslint', 'msw')

/** Plans and applies `facts` against `text` with the fixture registry (optionally extended). */
export function composeEslint(facts, text = ESLINT_CONFIG_TEXT, extend = () => {}) {
  const registry = createOperationRegistry()
  registerEslintFixtureOperations(registry)
  extend(registry)
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, text)
}

export const count = (text, predicate) => countNodes(ESLINT_CONFIG_PATH, text, predicate)
export const isIdentifier = (name) => (node) => ts.isIdentifier(node) && node.text === name
export const isConfigBlock = (name) => (node) => hasStringProperty(node, 'name', name)

/** The `{ paths?, patterns }` options object of `project/import-guards`' no-restricted-imports rule. */
export function importGuardOptions(text) {
  const model = parseStructuralModel(ESLINT_CONFIG_PATH, text)
  const ctx = { operationKey: 'test', describe: 'import-guards block' }
  const block = findUniqueNode(model, isConfigBlock('project/import-guards'), ctx)
  const rule = objectLiteralProperty(
    objectLiteralProperty(block, 'rules').initializer,
    'no-restricted-imports'
  )
  return rule.initializer.elements.find(ts.isObjectLiteralExpression)
}

export function assertStorybookRemoved(text) {
  assert.equal(
    count(text, (n) => isImportOf(n, 'eslint-plugin-storybook')),
    0
  )
  assert.equal(count(text, isIdentifier('storybookPlugin')), 0)
  assert.equal(
    count(text, (n) => isStringLiteralText(n, 'storybook-static/**')),
    0
  )
}

export function assertNavigationBanRemoved(text) {
  assert.equal(
    count(text, (n) => isVariableStatementNamed(n, 'NAVIGATION_PATHS')),
    0
  )
  assert.equal(count(text, isIdentifier('NAVIGATION_PATHS')), 0)
  const options = importGuardOptions(text)
  assert.equal(objectLiteralProperty(options, 'paths'), undefined)
  assert.ok(objectLiteralProperty(options, 'patterns'))
  for (const name of [
    'navigation-source',
    'route-progress-router-adapter',
    'route-progress-link-adapter',
  ]) {
    assert.equal(count(text, isConfigBlock(`project/import-guards-${name}`)), 0)
  }
}

/** Nodes no fixture operation targets must survive untouched. */
export function assertUnrelatedIntact(text) {
  assert.equal(
    count(text, (n) => isImportOf(n, 'eslint-plugin-boundaries')),
    1
  )
  assert.equal(
    count(text, (n) => isVariableStatementNamed(n, 'LAYER_BARREL')),
    1
  )
  assert.equal(count(text, isConfigBlock('project/syntax-guards')), 1)
  assert.equal(count(text, isConfigBlock('project/import-guards')), 1)
}

/**
 * Rewrites the single node matching `predicate` with `rewrite(originalNodeText)` —
 * how the robustness tests derive variants of the real file without copying a block.
 */
export function mutate(text, predicate, rewrite) {
  const model = parseStructuralModel(ESLINT_CONFIG_PATH, text)
  const ctx = { operationKey: 'mutation', describe: 'mutation target' }
  const node = findUniqueNode(model, predicate, ctx)
  model.replaceNode(node, rewrite(node.getText()), ctx)
  return serializeStructuralModel(model)
}

export const storybookImport = (n) => isImportOf(n, 'eslint-plugin-storybook')
export const navigationPaths = (n) => isVariableStatementNamed(n, 'NAVIGATION_PATHS')
export const ALL_FIXTURE_FACTS = [STORYBOOK, NAVIGATION, MSW]

export function assertAllApplied(result) {
  assertStorybookRemoved(result)
  assertNavigationBanRemoved(result)
  assertUnrelatedIntact(result)
  assert.equal(
    count(result, (n) => isStringLiteralText(n, 'public/mockServiceWorker.js')),
    0
  )
}
