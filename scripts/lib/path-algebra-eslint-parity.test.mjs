// Transitional parity oracle: the structural fixture operations must
// produce byte-for-byte what the authoritative text-based transforms
// produce today for the same real file, alone and composed. This is the
// only place M2 test code touches the existing engine (two pure functions,
// imported — not copied); PR3 retires the old transforms and this file with
// them. Production M2 modules still import nothing from the engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { removeStorybookFromEslintConfig } from './project-plan-storybook-eslint.mjs'
import { removeNavigationBanFromEslintConfig } from './project-plan-web-config.mjs'
import {
  ESLINT_CONFIG_TEXT,
  NAVIGATION,
  STORYBOOK,
  composeEslint,
} from './path-algebra-eslint-test-support.mjs'

test('storybook removal matches the existing engine byte-for-byte', () => {
  assert.equal(composeEslint([STORYBOOK]), removeStorybookFromEslintConfig(ESLINT_CONFIG_TEXT))
})

test('navigation-ban removal matches the existing engine byte-for-byte', () => {
  assert.equal(composeEslint([NAVIGATION]), removeNavigationBanFromEslintConfig(ESLINT_CONFIG_TEXT))
})

test('the two-operation composition matches the engine’s hand-written combined transform byte-for-byte', () => {
  assert.equal(
    composeEslint([STORYBOOK, NAVIGATION]),
    removeStorybookFromEslintConfig(removeNavigationBanFromEslintConfig(ESLINT_CONFIG_TEXT))
  )
})
