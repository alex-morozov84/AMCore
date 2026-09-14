// Real two- and three-operation composition of apps/web/eslint.config.mjs
// through the structural model. Assertions are on the *structure* of the
// result (re-parsed), never on copied text — see path-algebra-eslint-
// fixture-operations.mjs for how each operation locates its nodes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isImportOf,
  isStringLiteralText,
  isVariableStatementNamed,
  objectLiteralProperty,
} from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'
import {
  ESLINT_CONFIG_TEXT,
  MSW,
  NAVIGATION,
  STORYBOOK,
  assertNavigationBanRemoved,
  assertStorybookRemoved,
  assertUnrelatedIntact,
  composeEslint,
  count,
  fact,
  importGuardOptions,
} from './path-algebra-eslint-test-support.mjs'

const hasMswIgnore = (text) =>
  count(text, (n) => isStringLiteralText(n, 'public/mockServiceWorker.js'))

test('the fixture source is the real file and has every node the operations target', () => {
  assert.equal(
    count(ESLINT_CONFIG_TEXT, (n) => isImportOf(n, 'eslint-plugin-storybook')),
    1
  )
  assert.equal(
    count(ESLINT_CONFIG_TEXT, (n) => isVariableStatementNamed(n, 'NAVIGATION_PATHS')),
    1
  )
  assert.ok(objectLiteralProperty(importGuardOptions(ESLINT_CONFIG_TEXT), 'paths'))
  assert.equal(hasMswIgnore(ESLINT_CONFIG_TEXT), 1)
})

test('real two-operation composition (storybook + navigation ban) with zero combined adapter', () => {
  const result = composeEslint([STORYBOOK, NAVIGATION])
  assertStorybookRemoved(result)
  assertNavigationBanRemoved(result)
  assertUnrelatedIntact(result)
  assert.equal(hasMswIgnore(result), 1)
})

test('real three-operation composition adds the disjoint msw-ignore removal', () => {
  const result = composeEslint([STORYBOOK, NAVIGATION, MSW])
  assertStorybookRemoved(result)
  assertNavigationBanRemoved(result)
  assertUnrelatedIntact(result)
  assert.equal(hasMswIgnore(result), 0)
})

test('each single operation composes alone and leaves the other operations’ nodes in place', () => {
  assertStorybookRemoved(composeEslint([STORYBOOK]))
  assertNavigationBanRemoved(composeEslint([NAVIGATION]))
  const single = composeEslint([MSW])
  assert.equal(
    count(single, (n) => isVariableStatementNamed(n, 'NAVIGATION_PATHS')),
    1
  )
  assert.equal(
    count(single, (n) => isImportOf(n, 'eslint-plugin-storybook')),
    1
  )
})

test('composition result is byte-identical regardless of fact array order', () => {
  const facts = [STORYBOOK, NAVIGATION, MSW]
  const forward = composeEslint(facts)
  assert.equal(composeEslint([...facts].reverse()), forward)
  assert.equal(composeEslint([NAVIGATION, MSW, STORYBOOK]), forward)
})

test('the same operation requested by two dimensions applies once', () => {
  const twice = composeEslint([STORYBOOK, fact('remove-storybook-eslint', 'another-dimension')])
  assert.equal(twice, composeEslint([STORYBOOK]))
})

test('a fourth operation claiming an opposite value for a shared semantic location fails at planning', () => {
  const keepMsw = (registry) =>
    registry.define(
      'keep-msw-ignore-eslint',
      stubDefinition({
        deriveSemanticWrites: () => [
          { location: 'eslint-config:ignores:public/mockServiceWorker.js', value: 'present' },
        ],
      })
    )
  assert.throws(
    () =>
      composeEslint(
        [STORYBOOK, MSW, fact('keep-msw-ignore-eslint', 'keeper')],
        ESLINT_CONFIG_TEXT,
        keepMsw
      ),
    conflict(CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT)
  )
})

test('applying a composition to its own output fails closed — the nodes are gone, not silently skipped', () => {
  const once = composeEslint([STORYBOOK, NAVIGATION, MSW])
  assert.throws(
    () => composeEslint([STORYBOOK], once),
    conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE)
  )
  assert.throws(
    () => composeEslint([NAVIGATION], once),
    conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE)
  )
  assert.throws(() => composeEslint([MSW], once), conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE))
})
