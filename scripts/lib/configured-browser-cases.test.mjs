import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configuredBrowserCases, requireConfiguredBaseCases } from './configured-browser-cases.mjs'
import { proveBrowserCases } from '../stand/browser-case-evidence.mjs'
import { auditPlan } from './lighthouse-plan.mjs'
import { validateEnvelopes } from './lighthouse-ci-evidence.mjs'
import { configuredLanes } from '../e2e-ci-plan.mjs'

const identity = { run: '420', attempt: '1', source: 'a'.repeat(40) }
const baseIdentity = { ...identity, source: 'b'.repeat(40) }
const standard = 'configured-standard'
const current = (caseId, expectedStatus = 'passed', skipReason) => ({
  caseId,
  expectedStatus,
  skipReason,
  file: 'e2e/real-stack/example.spec.ts',
  title: caseId,
})
const collection = (source, cases, enabled = ['ru']) => ({
  ...source,
  settings: { locales: { enabled }, 'admin-console': { mode: 'disabled' } },
  lanes: Object.fromEntries(
    configuredLanes(process.cwd()).map((lane) => [
      lane,
      lane === standard ? cases : [current(lane)],
    ])
  ),
})

test('base applies settings, new cases join discovery, and unproved skips fail closed', () => {
  const baseline = collection(baseIdentity, [
    current('retained'),
    current('inapplicable', 'skipped', 'requires:multiple-locales'),
  ])
  const selected = collection(identity, [
    current('retained'),
    current('inapplicable', 'skipped', 'requires:multiple-locales'),
    current('new'),
  ])
  assert.doesNotThrow(() => requireConfiguredBaseCases(baseIdentity, baseline, selected))
  assert.throws(
    () =>
      requireConfiguredBaseCases(baseIdentity, baseline, collection(identity, [current('new')])),
    /Missing mandatory/
  )
  assert.throws(
    () =>
      requireConfiguredBaseCases(
        baseIdentity,
        baseline,
        collection(identity, [current('retained', 'skipped', 'reason')])
      ),
    /Missing mandatory/
  )
  assert.throws(
    () =>
      requireConfiguredBaseCases(
        baseIdentity,
        baseline,
        collection(identity, [current('retained'), current('new', 'skipped')])
      ),
    /no verified prerequisite/
  )
  assert.doesNotThrow(() =>
    requireConfiguredBaseCases(
      baseIdentity,
      baseline,
      collection(identity, [
        current('retained'),
        current('new', 'skipped', 'requires:multiple-locales'),
      ])
    )
  )
  for (const reason of ['any prose', 'requires:closed-signup-oauth', 'requires:disabled-console']) {
    assert.throws(
      () =>
        requireConfiguredBaseCases(
          baseIdentity,
          baseline,
          collection(identity, [current('retained'), current('new', 'skipped', reason)])
        ),
      /no verified prerequisite/
    )
  }
  const bilingual = (source, cases) => collection(source, cases, ['en', 'ru'])
  assert.throws(
    () =>
      requireConfiguredBaseCases(
        baseIdentity,
        bilingual(baseIdentity, [current('retained')]),
        bilingual(identity, [
          current('retained'),
          current('new', 'skipped', 'requires:multiple-locales'),
        ])
      ),
    /no verified prerequisite/
  )
  const plan = configuredBrowserCases(process.cwd(), identity, selected)
  const result = (id, status = 'passed') => ({
    id,
    expectedStatus: 'passed',
    results: [{ status }],
  })
  assert.equal(
    proveBrowserCases([result('new'), result('retained')], plan[standard]),
    plan[standard]
  )
  assert.throws(
    () => proveBrowserCases([result('retained')], plan[standard]),
    /Missing or unexpected/
  )
  assert.throws(
    () => proveBrowserCases([result('retained'), result('new', 'skipped')], plan[standard]),
    /did not run/
  )
  assert.throws(
    () => proveBrowserCases([result('retained'), result('new', 'failed')], plan[standard]),
    /did not run/
  )
  const audit = auditPlan(process.cwd(), identity, { configured: true, configuredCases: plan })
  const envelopes = Object.entries(audit.assignments).map(([lane, ids]) => ({
    ...identity,
    lane,
    plan: audit.digest,
    expected: ids,
    observed: ids,
    outcomes: {
      setup: 'passed',
      test: 'passed',
      termination: 'passed',
      cleanup: 'passed',
      originalUpload: 'passed',
      audit: ids.length ? 'passed' : 'not_applicable',
      export: ids.length ? 'passed' : 'not_applicable',
      view: ids.length ? 'passed' : 'not_applicable',
      upload: ids.length ? 'passed' : 'not_applicable',
    },
    ...(ids.length
      ? {
          artifactId: '1',
          archiveHash: 'c'.repeat(64),
          manifestHash: 'd'.repeat(64),
          viewHash: 'e'.repeat(64),
        }
      : {}),
    browserEvidence: { ...identity, lane, plan: audit.digest, observed: plan[lane] },
  }))
  const status = { 'web-e2e-plan': { result: 'success' }, 'web-e2e-lanes': { result: 'success' } }
  assert.doesNotThrow(() => validateEnvelopes(audit, envelopes, status))
  envelopes[0].browserEvidence.attempt = '2'
  assert.throws(
    () => validateEnvelopes(audit, envelopes, status),
    /missing-or-foreign-browser-case-evidence/
  )
})

test('known fixture cases are retained even when the configured stand does not run them', () => {
  for (const reason of ['requires:console-summary', 'requires:closed-signup-oauth']) {
    const present = current('fixture-case', 'skipped', reason)
    const baseline = collection(baseIdentity, [present])
    assert.doesNotThrow(() =>
      requireConfiguredBaseCases(baseIdentity, baseline, collection(identity, [present]))
    )
    for (const cases of [[], [current('fixture-case', 'skipped', 'requires:multiple-locales')]]) {
      assert.throws(
        () => requireConfiguredBaseCases(baseIdentity, baseline, collection(identity, cases)),
        /Missing configured browser cases with a fixture prerequisite/
      )
    }
  }
})

test('a new fixture case requires its selected profile and owning file', () => {
  const reason = 'requires:closed-signup-oauth'
  const baseline = collection(baseIdentity, [current('retained')])
  const added = current('new-fixture-case', 'skipped', reason)
  const included = collection(identity, [current('retained'), added])
  const validate = (fixture) =>
    requireConfiguredBaseCases(baseIdentity, baseline, included, fixture)
  assert.throws(() => validate(undefined), /New browser skip has no verified prerequisite/)
  assert.throws(
    () => validate({ file: 'other.spec.ts', prerequisite: reason }),
    /New browser skip has no verified prerequisite/
  )
  assert.doesNotThrow(() => validate({ file: added.file, prerequisite: reason }))
})

test('fixed upstream lanes retain their cases independently of the configured lanes', () => {
  const base = collection(baseIdentity, [current('retained')])
  const head = collection(identity, [current('retained')])
  const host = [
    { ...current('isolated session'), id: 'isolated:host' },
    { ...current('MFA reentry'), id: 'reentry:host' },
  ]
  const check = (fixed) =>
    requireConfiguredBaseCases(
      baseIdentity,
      { ...base, fixed: { host } },
      { ...head, fixed },
      undefined,
      true
    )
  assert.doesNotThrow(() => check({ host }))
  assert.throws(() => check(undefined), /Missing fixed browser inventory/)
  assert.throws(() => check({ host: [host[1]] }), /isolated session/)
  assert.throws(
    () => check({ host: [{ ...host[0], expectedStatus: 'skipped' }, host[1]] }),
    /isolated session/
  )
})
