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

function block(model, name, ctx) {
  return findUniqueNode(model, (node) => hasStringProperty(node, 'name', name), {
    ...ctx,
    describe: `config block named "${name}"`,
  })
}

function property(model, object, name, ctx) {
  return findUniqueNode(
    model,
    (node) => objectLiteralProperty(object, name) === node,
    { ...ctx, describe: `"${name}" property` },
    object
  )
}

function ignore(model, text, ctx) {
  const ignores = property(model, block(model, 'project/ignores', ctx), 'ignores', ctx)
  return findUniqueNode(
    model,
    (node) => isStringLiteralText(node, text),
    { ...ctx, describe: `ignore entry "${text}"` },
    ignores.initializer
  )
}

function ruleOptions(model, ctx) {
  const rules = property(model, block(model, 'project/import-guards', ctx), 'rules', ctx)
  const rule = property(model, rules.initializer, 'no-restricted-imports', ctx).initializer
  return findUniqueNode(
    model,
    (node) => ts.isObjectLiteralExpression(node) && node.parent === rule,
    { ...ctx, describe: 'no-restricted-imports options object' },
    rule
  )
}

const absent = (location) => ({ location: `eslint:${location}`, value: 'absent' })
const noParams = (params) =>
  params !== null && typeof params === 'object' && Object.keys(params).length === 0

function removeStorybook(model, params, ctx) {
  const imported = findUniqueNode(
    model,
    (node) => isImportOf(node, 'eslint-plugin-storybook') && node.importClause?.name,
    { ...ctx, describe: "default import of 'eslint-plugin-storybook'" }
  )
  const binding = imported.importClause.name.text
  const spread = findUniqueNode(
    model,
    (node) => ts.isSpreadElement(node) && isRootedInIdentifier(node.expression, binding),
    { ...ctx, describe: `spread of "${binding}"` }
  )
  model.removeNode(imported, ctx)
  model.removeNode(spread, ctx)
  model.removeNode(ignore(model, 'storybook-static/**', ctx), ctx)
}

const EXEMPTIONS = [
  'project/import-guards-navigation-source',
  'project/import-guards-route-progress-router-adapter',
  'project/import-guards-route-progress-link-adapter',
]

function removeNavigation(model, params, ctx) {
  const declaration = findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, 'NAVIGATION_PATHS'),
    {
      ...ctx,
      describe: 'declaration of NAVIGATION_PATHS',
    }
  )
  model.removeNode(declaration, ctx)
  model.removeNode(property(model, ruleOptions(model, ctx), 'paths', ctx), ctx)
  for (const name of EXEMPTIONS) model.removeNode(block(model, name, ctx), ctx)
}

export function registerProjectConfigOperations(registry) {
  registry.define('project-eslint-remove-navigation', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('declaration:NAVIGATION_PATHS'),
      absent('rule:no-restricted-imports:paths'),
      ...EXEMPTIONS.map((name) => absent(`block:${name}`)),
    ],
    adapter: removeNavigation,
  })
  registry.define('project-eslint-remove-storybook', {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('import:eslint-plugin-storybook'),
      absent('ignores:storybook-static/**'),
      absent('block:storybook-flat-recommended'),
    ],
    adapter: removeStorybook,
  })
}
