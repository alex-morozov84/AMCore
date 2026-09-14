// Structural adapters must survive edits that would break exact-text
// anchors — unrelated comments, reformatting, sibling declarations. Every
// variant is derived from the real file through the model itself, so this
// file copies no source block either. Fail-closed cases on the same
// variants live in path-algebra-eslint-fail-closed.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { isStringLiteralText, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import {
  ALL_FIXTURE_FACTS as ALL,
  ESLINT_CONFIG_TEXT,
  STORYBOOK,
  assertAllApplied,
  assertStorybookRemoved,
  composeEslint,
  count,
  isConfigBlock,
  mutate,
  navigationPaths,
  storybookImport,
} from './path-algebra-eslint-test-support.mjs'

test('a detached comment (blank line before the target) neither breaks the adapter nor is removed', () => {
  const source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    (t) => `// unrelated maintainer note\n\n${t}`
  )
  const result = composeEslint(ALL, source)
  assertAllApplied(result)
  assert.ok(result.includes('// unrelated maintainer note'))
})

test('a comment attached to the target (no blank line) goes with it — the documented semantics', () => {
  const source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    (t) => `// why this plugin is here\n${t}`
  )
  const result = composeEslint(ALL, source)
  assertAllApplied(result)
  assert.ok(!result.includes('// why this plugin is here'))
})

test('a trailing same-line comment on a targeted list entry does not break removal', () => {
  const isEntry = (n) => isStringLiteralText(n, 'storybook-static/**')
  const source = mutate(ESLINT_CONFIG_TEXT, isEntry, (t) => `${t} /* generated */`)
  assertAllApplied(composeEslint(ALL, source))
})

test('reformatting — quote style, dropped semicolons, a collapsed multi-line declaration — is irrelevant', () => {
  let source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    () => 'import storybookPlugin from "eslint-plugin-storybook"'
  )
  source = mutate(
    source,
    navigationPaths,
    () => "const NAVIGATION_PATHS = [{ name: 'next/link', message: 'reformatted' }]"
  )
  source = mutate(
    source,
    (n) => isStringLiteralText(n, 'storybook-static/**'),
    () => '"storybook-static/**"'
  )
  assertAllApplied(composeEslint(ALL, source))
})

test('sibling declarations and an extra config block next to the targets survive untouched', () => {
  let source = mutate(
    ESLINT_CONFIG_TEXT,
    navigationPaths,
    (t) => `const UNRELATED_SIBLING = 1;\n${t}`
  )
  source = mutate(
    source,
    isConfigBlock('project/import-guards'),
    (t) => `{ name: 'project/extra-block', rules: {} },\n  ${t}`
  )
  const result = composeEslint(ALL, source)
  assertAllApplied(result)
  assert.equal(
    count(result, (n) => isVariableStatementNamed(n, 'UNRELATED_SIBLING')),
    1
  )
  assert.equal(count(result, isConfigBlock('project/extra-block')), 1)
})

test('the binding name of the storybook import is read from the import, not assumed', () => {
  let source = mutate(
    ESLINT_CONFIG_TEXT,
    storybookImport,
    () => "import sb from 'eslint-plugin-storybook';"
  )
  const isOldSpread = (n) => ts.isSpreadElement(n) && n.getText().includes('storybookPlugin')
  source = mutate(source, isOldSpread, () => "...sb.configs['flat/recommended']")
  const result = composeEslint([STORYBOOK], source)
  assertStorybookRemoved(result)
  assert.equal(
    count(result, (n) => ts.isIdentifier(n) && n.text === 'sb'),
    0
  )
})
