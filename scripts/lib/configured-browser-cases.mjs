import assert from 'node:assert/strict'
import { configuredLanes, consoleFixture } from '../e2e-ci-plan.mjs'
import { caseDigest } from '../stand/browser-case-evidence.mjs'

// Configured collections have no specialist fixture. A test can declare
// prerequisites of the selected settings, never a free-form waiver.
function knownInapplicability(reason, settings, existingFixtureCase = false) {
  switch (reason) {
    case 'requires:multiple-locales':
      return settings.locales.enabled.length === 1
    case 'requires:path-console':
      return settings['admin-console'].mode !== 'path'
    case 'requires:disabled-console':
      return settings['admin-console'].mode !== 'disabled'
    case 'requires:console-summary':
    case 'requires:closed-signup-oauth':
      return existingFixtureCase
    default:
      return false
  }
}

export function configuredBrowserCases(root, identity, collection) {
  const { lanes, settings, ...sourceIdentity } = collection
  assert.deepEqual(sourceIdentity, identity, 'Configured collection identity mismatch')
  const expected = configuredLanes(root)
  assert.deepEqual(Object.keys(lanes), expected, 'Configured collection lanes mismatch')
  return Object.fromEntries(
    expected.map((lane) => {
      const tests = lanes[lane].filter(({ expectedStatus }) => expectedStatus !== 'skipped')
      const invalid = lanes[lane].filter(
        ({ expectedStatus, skipReason }) =>
          expectedStatus === 'skipped' && !knownInapplicability(skipReason, settings, true)
      )
      assert.deepEqual(
        invalid.map(({ file, title }) => `${file}: ${title}`),
        [],
        'Browser skip has no verified prerequisite'
      )
      assert.ok(tests.every(({ expectedStatus }) => expectedStatus === 'passed'))
      return [lane, caseDigest(tests.map(({ caseId }) => caseId))]
    })
  )
}

function fixturePrerequisite({ expectedStatus, skipReason }) {
  return (
    expectedStatus === 'skipped' &&
    ['requires:console-summary', 'requires:closed-signup-oauth'].includes(skipReason)
  )
}

function requireRetainedFixtureCases(base, head, lane) {
  const current = new Map(head.map((item) => [item.caseId, item]))
  const missing = base.filter((item) => {
    const candidate = current.get(item.caseId)
    return (
      fixturePrerequisite(item) &&
      candidate?.expectedStatus !== 'passed' &&
      candidate?.skipReason !== item.skipReason
    )
  })
  assert.deepEqual(
    missing.map(({ file, title }) => `${lane}: ${file} — ${title}`),
    [],
    'Missing configured browser cases with a fixture prerequisite'
  )
}

function isFixtureCase(item, fixture) {
  return (
    fixture &&
    item.expectedStatus === 'skipped' &&
    item.file === fixture.file &&
    item.skipReason === fixture.prerequisite
  )
}

/** Preserve every applicable base case under the settings used for the PR. */
export function requireConfiguredBaseCases(identity, baseCollection, headCollection, fixture) {
  const { lanes, settings, ...baseIdentity } = baseCollection
  assert.deepEqual(baseIdentity, identity, 'Configured base collection identity mismatch')
  assert.ok(settings && headCollection.settings, 'Missing projected browser settings')
  assert.deepEqual(
    settings,
    headCollection.settings,
    'Browser base projected under different settings'
  )
  assert.ok(lanes?.['configured-standard']?.length, 'Missing configured base cases')
  for (const lane of new Set([...Object.keys(lanes), ...Object.keys(headCollection.lanes)])) {
    const cases = lanes[lane] ?? []
    const head = headCollection.lanes[lane] ?? []
    requireRetainedFixtureCases(cases, head, lane)
    const current = new Set(
      head.filter(({ expectedStatus }) => expectedStatus === 'passed').map(({ caseId }) => caseId)
    )
    const baseIds = new Set(cases.map(({ caseId }) => caseId))
    const invalidNew = head.filter(
      (item) =>
        item.expectedStatus === 'skipped' &&
        !baseIds.has(item.caseId) &&
        !knownInapplicability(item.skipReason, settings) &&
        !isFixtureCase(item, fixture)
    )
    assert.deepEqual(
      invalidNew.map(({ file, title }) => `${file}: ${title}`),
      [],
      'New browser skip has no verified prerequisite'
    )
    const missing = cases
      .filter(({ expectedStatus, caseId }) => expectedStatus === 'passed' && !current.has(caseId))
      .map(({ file, title, caseId }) => `${lane}: ${file} — ${title} (${caseId})`)
    assert.ok(
      missing.length === 0,
      `Missing mandatory configured browser cases:
${missing.join('\n')}`
    )
  }
}

export function configuredConsoleFixtureDigest(root, collection) {
  const fixture = consoleFixture(root)
  if (!fixture) return
  const lane = fixture.project === 'real-stack' ? 'configured-standard' : 'configured-console'
  return caseDigest(
    collection.lanes[lane]
      .filter((item) => isFixtureCase(item, fixture))
      .map(({ caseId }) => caseId)
  )
}
