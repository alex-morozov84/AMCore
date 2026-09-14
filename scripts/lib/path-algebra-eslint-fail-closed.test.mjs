// The real-file fixture operations must fail closed — with the semantic
// diagnostic, never a TypeError or a silent no-op — when the node they
// target is missing, duplicated, or not the shape they require.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict } from './path-algebra-test-helpers.mjs'
import {
  ESLINT_CONFIG_TEXT,
  NAVIGATION,
  STORYBOOK,
  composeEslint,
  isConfigBlock,
  mutate,
  storybookImport,
} from './path-algebra-eslint-test-support.mjs'

const missing = conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE)
const ambiguous = conflict(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE)

test('a duplicated config block name makes the node ambiguous and fails closed', () => {
  const isBlock = isConfigBlock('project/import-guards-navigation-source')
  const source = mutate(ESLINT_CONFIG_TEXT, isBlock, (t) => `${t},\n  ${t}`)
  assert.throws(() => composeEslint([NAVIGATION], source), ambiguous)
})

test('a second import of the same module makes the node ambiguous and fails closed', () => {
  const source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    (t) => `${t}\nimport storybookAgain from 'eslint-plugin-storybook';`
  )
  assert.throws(() => composeEslint([STORYBOOK], source), ambiguous)
})

test('a named-only import of the storybook plugin is a missing default import, not a TypeError', () => {
  const source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    () => "import { configs } from 'eslint-plugin-storybook';"
  )
  assert.throws(
    () => composeEslint([STORYBOOK], source),
    (error) => missing(error) && /default import/.test(error.message)
  )
})

test('a renamed option property is a missing node, reported by its semantic description', () => {
  const isPathsOption = (n) =>
    ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'paths'
  const source = mutate(ESLINT_CONFIG_TEXT, isPathsOption, (t) => t.replace('paths', 'renamed'))
  assert.throws(
    () => composeEslint([NAVIGATION], source),
    (error) => missing(error) && error.message.includes('"paths" property')
  )
})

test('a renamed config block is a missing node, reported by the block name', () => {
  const isBlock = isConfigBlock('project/ignores')
  const source = mutate(ESLINT_CONFIG_TEXT, isBlock, (t) =>
    t.replace("'project/ignores'", "'project/renamed'")
  )
  assert.throws(
    () => composeEslint([STORYBOOK], source),
    (error) => missing(error) && error.message.includes('"project/ignores"')
  )
})

test('the diagnostic carries the operation key and the path so a caller can act on it', () => {
  const source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    () => "import unrelated from 'somewhere-else';"
  )
  assert.throws(
    () => composeEslint([STORYBOOK], source),
    (error) =>
      missing(error) &&
      error.message.includes('"remove-storybook-eslint"') &&
      error.paths.includes('apps/web/eslint.config.mjs')
  )
})
