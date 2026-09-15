// Transitional parity oracle: the structural fixture operations must
// produce byte-for-byte what the authoritative text-based transforms
// produce today for the same real file, alone and composed. This is the
// only place M2 test code touches the existing engine (two pure functions,
// imported — not copied); PR3 retires the old transforms and this file with
// them. Production M2 modules still import nothing from the engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { registerProjectConfigOperations } from './project-config-operations.mjs'
import {
  ESLINT_CONFIG_TEXT,
  NAVIGATION,
  STORYBOOK,
  composeEslint,
} from './path-algebra-eslint-test-support.mjs'

function composeProduction(keys) {
  const registry = createOperationRegistry()
  registerProjectConfigOperations(registry)
  const facts = keys.map((operationKey) => ({
    kind: 'structural',
    dimension: operationKey,
    path: 'apps/web/eslint.config.mjs',
    operationKey,
    params: {},
  }))
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, ESLINT_CONFIG_TEXT)
}

test('storybook removal matches the M2 fixture model byte-for-byte', () => {
  assert.equal(composeProduction(['project-eslint-remove-storybook']), composeEslint([STORYBOOK]))
})

test('navigation-ban removal matches the M2 fixture model byte-for-byte', () => {
  assert.equal(composeProduction(['project-eslint-remove-navigation']), composeEslint([NAVIGATION]))
})

test('the two-operation composition matches the M2 fixture model byte-for-byte', () => {
  assert.equal(
    composeProduction(['project-eslint-remove-storybook', 'project-eslint-remove-navigation']),
    composeEslint([STORYBOOK, NAVIGATION])
  )
})
