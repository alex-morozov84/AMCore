import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import {
  createBaseCopy,
  displayCapture,
  INTENTIONAL_DELTAS,
  legacyPrepare,
  operationCapture,
  treeDiff,
} from './project-storybook-parity-helpers.mjs'

function flags(locale, routeProgress, consoleMode) {
  return {
    storybook: 'disabled',
    ...(locale ? { mode: 'single', locale } : {}),
    ...(routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(consoleMode ? { 'admin-console': consoleMode } : {}),
  }
}

function expectedDeltas(consoleMode) {
  return [...INTENTIONAL_DELTAS]
    .filter(
      (pathname) =>
        pathname !== 'docs/operations-console/development.md' || consoleMode !== 'disabled'
    )
    .sort()
}

async function compareCombination(selected) {
  const legacyCopy = createBaseCopy()
  const currentCopy = createBaseCopy()
  try {
    const prepareLegacy = await legacyPrepare(legacyCopy.root)
    const oldPlan = prepareLegacy(legacyCopy.root, selected.flags, 'panel')
    const newPlan = prepareProjectInit(currentCopy.root, selected.flags, 'panel')
    assert.deepEqual(
      displayCapture(currentCopy.root, newPlan.steps),
      displayCapture(legacyCopy.root, oldPlan.steps),
      selected.name
    )
    assert.deepEqual(operationCapture(newPlan), operationCapture(oldPlan), selected.name)
    assert.equal(newPlan.confirmMessage, oldPlan.confirmMessage)
    applyFilesystemTransaction({
      root: legacyCopy.root,
      operations: oldPlan.operationPlan.operationsForApply(),
    })
    applyFilesystemTransaction({
      root: currentCopy.root,
      operations: newPlan.operationPlan.operationsForApply(),
    })
    assert.deepEqual(treeDiff(legacyCopy.root, currentCopy.root), selected.expected, selected.name)
    newPlan.assertApplied()
  } finally {
    legacyCopy.cleanup()
    currentCopy.cleanup()
  }
}

describe('Storybook legacy-to-facts parity', () => {
  test('preserves all unchanged bytes and names only the six reviewed deltas', async () => {
    for (const locale of [undefined, 'en', 'ru']) {
      for (const routeProgress of [false, true]) {
        for (const consoleMode of [undefined, 'disabled', 'path', 'host']) {
          await compareCombination({
            name: `${locale ?? 'multi'}-${routeProgress ? 'off' : 'on'}-${consoleMode ?? 'default'}`,
            flags: flags(locale, routeProgress, consoleMode),
            expected: expectedDeltas(consoleMode),
          })
        }
      }
    }
  })
})
