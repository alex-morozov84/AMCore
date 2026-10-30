import { invariant } from './lighthouse-plan.mjs'

export function validateEnvelopes(plan, envelopes, jobResults) {
  invariant(
    ['web-e2e-plan', 'web-e2e-lanes'].every((key) => jobResults[key]?.result === 'success'),
    'earlier-ci-failure'
  )
  const expected = Object.keys(plan.assignments)
  invariant(
    envelopes.length === expected.length &&
      new Set(envelopes.map((e) => e.lane)).size === expected.length,
    'missing-or-duplicate-lane-evidence'
  )
  for (const e of envelopes) {
    invariant(
      expected.includes(e.lane) &&
        e.run === plan.run &&
        e.attempt === plan.attempt &&
        e.source === plan.source &&
        e.plan === plan.digest,
      'stale-or-foreign-lane-evidence'
    )
    const ids = plan.assignments[e.lane]
    invariant(
      JSON.stringify(e.expected) === JSON.stringify(ids) &&
        JSON.stringify(e.observed) === JSON.stringify(ids),
      'missing-or-duplicate-scenario'
    )
    invariant(
      ['setup', 'test', 'termination', 'cleanup', 'originalUpload'].every(
        (key) => e.outcomes?.[key] === 'passed'
      ),
      'lane-lifecycle-failure'
    )
    invariant(
      e.outcomes.audit === (ids.length ? 'passed' : 'not_applicable'),
      'invalid-audit-outcome'
    )
    if (ids.length)
      invariant(
        /^\d+$/.test(String(e.artifactId)) &&
          /^[a-f0-9]{64}$/.test(e.manifestHash) &&
          /^[a-f0-9]{64}$/.test(e.archiveHash) &&
          e.outcomes.export === 'passed' &&
          e.outcomes.upload === 'passed',
        'missing-owner-bundle'
      )
    else
      invariant(
        e.artifactId === undefined &&
          e.outcomes.export === 'not_applicable' &&
          e.outcomes.upload === 'not_applicable',
        'unexpected-non-owner-bundle'
      )
  }
  return envelopes.filter((e) => plan.assignments[e.lane].length)
}

export function validateOwnerBundle(plan, envelope, manifest, provenance) {
  invariant(
    provenance && ['lock', 'content', 'tooling'].every((key) => manifest[key] === provenance[key]),
    'build-provenance-mismatch'
  )
  invariant(
    manifest.priorTests === 'passed' && manifest.localAudit === false,
    'local-audit-is-not-ci-e2e-evidence'
  )
  invariant(
    manifest.version === 1 &&
      manifest.plan === plan.digest &&
      manifest.run === plan.run &&
      manifest.attempt === plan.attempt &&
      manifest.source === plan.source &&
      manifest.lane === envelope.lane,
    'wrong-owner-bundle'
  )
  invariant(
    manifest.config === plan.config &&
      manifest.descriptors === plan.descriptors &&
      /^[a-f0-9]{64}$/.test(manifest.lock) &&
      /^[a-f0-9]{64}$/.test(manifest.content) &&
      typeof manifest.build === 'string' &&
      manifest.build.length > 0,
    'missing-build-provenance'
  )
  invariant(
    manifest.coverage?.rows?.length > 0 && /^[a-f0-9]{64}$/.test(manifest.coverage.digest),
    'missing-built-coverage'
  )
  const expected = plan.assignments[envelope.lane]
  invariant(
    JSON.stringify(manifest.results?.map((r) => r.id)) === JSON.stringify(expected),
    'wrong-bundle-scenarios'
  )
  invariant(
    manifest.results.every(
      (r) =>
        r.valid === true &&
        r.policy?.passed === true &&
        r.identity === true &&
        r.requiredData === true
    ),
    'invalid-owner-result'
  )
  invariant(
    manifest.files.length === 2 * expected.length &&
      manifest.files.every((f) =>
        expected.some((id) => f.name === `${id}.html` || f.name === `${id}.json`)
      ),
    'wrong-owner-files'
  )
  return true
}
