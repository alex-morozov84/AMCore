import assert from 'node:assert/strict'
import { test } from 'node:test'

import { areRulesEvaluated, checkRuleGroups } from './rules.mjs'
import { extractRuleFiles } from '../extract/yaml-rules.mjs'

const DEFAULT_GROUPS = extractRuleFiles(['docs/operations/prometheus/amcore-alerts.yml']).groupNames

function mockRulesFetch(groups) {
  return async () => ({
    status: 200,
    json: async () => ({ status: 'success', data: { groups } }),
  })
}

const okGroup = (name) => ({ name, rules: [{ name: `${name}-rule`, health: 'ok' }] })

test('all 8 default groups present and healthy passes', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockRulesFetch(DEFAULT_GROUPS.map(okGroup))
  try {
    assert.deepEqual(await checkRuleGroups(), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

// R1 regression: a rule that has never evaluated (health "unknown") must
// block readiness, not be treated as ready.
test('areRulesEvaluated is false while any default-group rule is still "unknown"', async () => {
  const originalFetch = globalThis.fetch
  const groups = DEFAULT_GROUPS.map(okGroup)
  groups[0].rules[0].health = 'unknown'
  globalThis.fetch = mockRulesFetch(groups)
  try {
    assert.equal(await areRulesEvaluated(), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('areRulesEvaluated is true once every default-group rule has evaluated', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockRulesFetch(DEFAULT_GROUPS.map(okGroup))
  try {
    assert.equal(await areRulesEvaluated(), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// R3 regression: an unexpected extra rule group (not just "an optional group
// wrongly loaded") must fail, not be silently ignored.
test('an unexpected extra rule group is rejected', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockRulesFetch([...DEFAULT_GROUPS.map(okGroup), okGroup('mystery-group')])
  try {
    const violations = await checkRuleGroups()
    assert.ok(violations.some((v) => v.includes('unexpected rule group "mystery-group"')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a missing default group is rejected', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockRulesFetch(DEFAULT_GROUPS.slice(1).map(okGroup))
  try {
    const violations = await checkRuleGroups()
    assert.ok(
      violations.some((v) =>
        v.includes(`expected default group "${DEFAULT_GROUPS[0]}" is not loaded`)
      )
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
