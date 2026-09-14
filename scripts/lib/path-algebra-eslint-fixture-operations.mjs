// Test-support fixture operations against the real `apps/web/eslint.config.mjs`
// (BACKLOG item 14, PR2/M2, FINAL PLAN §2.2). Not a `.test.mjs` file, so the
// `node --test` glob never runs it; not imported by the existing engine —
// PR3 owns the real transform migration, so these operations stay a fixture
// that proves the structural model on a real file. Every node is located by
// AST shape (module specifier, binding identifier, config-block `name`,
// property key), never by copied source text.
import ts from 'typescript'
import {
  findUniqueNode,
  hasStringProperty,
  isImportOf,
  isRootedInIdentifier,
  isStringLiteralText,
  isVariableStatementNamed,
  objectLiteralProperty,
} from './path-algebra-ast-query.mjs'

export const ESLINT_CONFIG_PATH = 'apps/web/eslint.config.mjs'

const absent = (location) => ({ location: `eslint-config:${location}`, value: 'absent' })

/** The flat-config block `{ name: '<name>', ... }` — a config block's identity. */
function configBlock(model, name, ctx) {
  return findUniqueNode(model, (node) => hasStringProperty(node, 'name', name), {
    ...ctx,
    describe: `config block named "${name}"`,
  })
}

/** The `<name>:` property assignment of one object literal, fail-closed when absent. */
function requireProperty(model, object, name, ctx) {
  return findUniqueNode(
    model,
    (node) => objectLiteralProperty(object, name) === node,
    { ...ctx, describe: `"${name}" property` },
    object
  )
}

/** One string entry of `project/ignores`' `ignores: [...]` array. */
function ignoreEntry(model, text, ctx) {
  const ignores = requireProperty(model, configBlock(model, 'project/ignores', ctx), 'ignores', ctx)
  return findUniqueNode(
    model,
    (node) => isStringLiteralText(node, text),
    { ...ctx, describe: `ignore entry "${text}"` },
    ignores.initializer
  )
}

/** The options object of `rules: { '<ruleName>': ['error', { ...options }] }` inside one config block. */
function ruleOptionsObject(model, blockName, ruleName, ctx) {
  const rules = requireProperty(model, configBlock(model, blockName, ctx), 'rules', ctx)
  const options = requireProperty(model, rules.initializer, ruleName, ctx).initializer
  return findUniqueNode(
    model,
    (node) => ts.isObjectLiteralExpression(node) && node.parent === options,
    { ...ctx, describe: `options object of rule "${ruleName}" in config block "${blockName}"` },
    options
  )
}

function removeStorybook(model, params, ctx) {
  const importNode = findUniqueNode(
    model,
    (node) => isImportOf(node, 'eslint-plugin-storybook') && node.importClause?.name !== undefined,
    { ...ctx, describe: "default import of 'eslint-plugin-storybook'" }
  )
  const binding = importNode.importClause.name.text
  const spread = findUniqueNode(
    model,
    (node) => ts.isSpreadElement(node) && isRootedInIdentifier(node.expression, binding),
    { ...ctx, describe: `spread of the "${binding}" binding` }
  )
  model.removeNode(importNode, ctx)
  model.removeNode(spread, ctx)
  model.removeNode(ignoreEntry(model, 'storybook-static/**', ctx), ctx)
}

const NAVIGATION_EXEMPTION_BLOCKS = [
  'project/import-guards-navigation-source',
  'project/import-guards-route-progress-router-adapter',
  'project/import-guards-route-progress-link-adapter',
]

function removeNavigationBan(model, params, ctx) {
  const paths = findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, 'NAVIGATION_PATHS'),
    {
      ...ctx,
      describe: 'declaration of NAVIGATION_PATHS',
    }
  )
  const options = ruleOptionsObject(model, 'project/import-guards', 'no-restricted-imports', ctx)
  const pathsOption = requireProperty(model, options, 'paths', ctx)
  model.removeNode(paths, ctx)
  model.removeNode(pathsOption, ctx)
  for (const name of NAVIGATION_EXEMPTION_BLOCKS)
    model.removeNode(configBlock(model, name, ctx), ctx)
}

function removeMockServiceWorkerIgnore(model, params, ctx) {
  model.removeNode(ignoreEntry(model, 'public/mockServiceWorker.js', ctx), ctx)
}

const noParams = (params) =>
  params !== null && typeof params === 'object' && Object.keys(params).length === 0

/** Registers the three real-file fixture operations; call sites then supply only key + params. */
export function registerEslintFixtureOperations(registry) {
  registry.define('remove-storybook-eslint', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('import:eslint-plugin-storybook'),
      absent('ignores:storybook-static/**'),
      absent('block:storybook-flat-recommended'),
    ],
    adapter: removeStorybook,
  })
  registry.define('remove-navigation-ban-eslint', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('declaration:NAVIGATION_PATHS'),
      absent('rule:project/import-guards:no-restricted-imports:paths'),
      ...NAVIGATION_EXEMPTION_BLOCKS.map((name) => absent(`block:${name}`)),
    ],
    adapter: removeNavigationBan,
  })
  registry.define('remove-msw-ignore-eslint', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [absent('ignores:public/mockServiceWorker.js')],
    adapter: removeMockServiceWorkerIgnore,
  })
}
