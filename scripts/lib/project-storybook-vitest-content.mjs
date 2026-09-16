import ts from 'typescript'

import {
  findUniqueNode,
  isImportOf,
  isStringLiteralText,
  isVariableStatementNamed,
  objectLiteralProperty,
} from './path-algebra-ast-query.mjs'

export const STORYBOOK_VITEST_OPERATION_KEY = 'storybook.vitest-project'

const noParams = (params) => params && Object.keys(params).length === 0
const absent = (location) => ({ location: `vitest:${location}`, value: 'absent' })
const UNIT_PROJECT_COMMENT = `
    // A one-entry array, not a flat test block — keeps \`--project=unit\`
    // (package.json's test/test:run/test:coverage scripts) working
    // unchanged, and this file's shape stable if a second project is ever
    // added back.
    `

function rangeNode(start, end) {
  return { getStart: () => start, end }
}

function projectName(node) {
  if (!ts.isObjectLiteralExpression(node)) return undefined
  const test = objectLiteralProperty(node, 'test')?.initializer
  if (!test || !ts.isObjectLiteralExpression(test)) return undefined
  const name = objectLiteralProperty(test, 'name')?.initializer
  return name
}

function storybookProject(model, ctx) {
  return findUniqueNode(
    model,
    (node) => {
      const name = projectName(node)
      return name !== undefined && isStringLiteralText(name, 'storybook')
    },
    { ...ctx, describe: 'Vitest project whose test.name is "storybook"' }
  )
}

function removeStorybookProject(model, _params, ctx) {
  const importOf = (moduleName) =>
    findUniqueNode(model, (node) => isImportOf(node, moduleName), {
      ...ctx,
      describe: `import of "${moduleName}"`,
    })
  const first = importOf('node:path')
  importOf('node:url')
  importOf('@storybook/addon-vitest/vitest-plugin')
  const reactImport = importOf('@vitejs/plugin-react')
  model.replaceNode(rangeNode(first.getStart(), reactImport.getStart()), '', ctx)
  model.removeNode(importOf('@vitest/browser-playwright'), ctx)
  model.removeNode(
    findUniqueNode(model, (node) => isVariableStatementNamed(node, 'dirname'), {
      ...ctx,
      describe: 'dirname declaration',
    }),
    ctx
  )
  const project = storybookProject(model, ctx)
  const projectsProperty = project.parent.parent
  const commentStart = projectsProperty.getFullStart()
  const propertyStart = projectsProperty.getStart()
  const trivia = model.text.slice(commentStart, propertyStart)
  if (!trivia.includes('Two named projects, not one shared config')) {
    throw new Error('Vitest projects comment semantic anchor is missing')
  }
  model.replaceNode(rangeNode(commentStart, propertyStart), UNIT_PROJECT_COMMENT, ctx)
  model.removeNode(project, ctx)
}

export function registerStorybookStructuralOperations(registry) {
  registry.define(STORYBOOK_VITEST_OPERATION_KEY, {
    paramsSchema: noParams,
    deriveSemanticWrites: () => [
      absent('import:node:path'),
      absent('import:node:url'),
      absent('import:@storybook/addon-vitest/vitest-plugin'),
      absent('import:@vitest/browser-playwright'),
      absent('declaration:dirname'),
      absent('project:storybook'),
      { location: 'vitest:comment:projects', value: 'unit-only' },
    ],
    adapter: removeStorybookProject,
  })
}
