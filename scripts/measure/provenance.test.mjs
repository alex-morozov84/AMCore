import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectRunProvenance, classifyComparability, stampScenario } from './provenance.mjs'

describe('provenance', () => {
  test('collectRunProvenance returns a real, well-shaped snapshot', () => {
    const provenance = collectRunProvenance()
    assert.match(provenance.repoSha, /^[0-9a-f]{40}$/)
    assert.equal(typeof provenance.repoDirty, 'boolean')
    assert.equal(provenance.fixtureSha, provenance.repoSha)
    assert.equal(provenance.cliSha, provenance.repoSha)
    assert.match(provenance.nodeVersion, /^v\d+\./)
    assert.match(provenance.pnpmVersion, /^\d+\./)
    assert.ok(['local', 'github-actions'].includes(provenance.environment))
  })

  test('classifyComparability fails closed on a dirty tree, even with matching shas', () => {
    const result = classifyComparability({
      repoSha: 'x'.repeat(40),
      repoDirty: true,
      fixtureSha: 'x'.repeat(40),
      cliSha: 'x'.repeat(40),
    })
    assert.equal(result.comparable, false)
    assert.match(result.reason, /dirty/)
  })

  test('classifyComparability fails closed on a fixture/repo sha mismatch', () => {
    const result = classifyComparability({
      repoSha: 'a'.repeat(40),
      repoDirty: false,
      fixtureSha: 'b'.repeat(40),
      cliSha: 'a'.repeat(40),
    })
    assert.equal(result.comparable, false)
  })

  test('classifyComparability fails closed on a cli/repo sha mismatch', () => {
    const result = classifyComparability({
      repoSha: 'a'.repeat(40),
      repoDirty: false,
      fixtureSha: 'a'.repeat(40),
      cliSha: 'c'.repeat(40),
    })
    assert.equal(result.comparable, false)
  })

  test('classifyComparability accepts a clean, matching revision', () => {
    const sha = 'a'.repeat(40)
    const result = classifyComparability({ repoSha: sha, repoDirty: false, fixtureSha: sha, cliSha: sha })
    assert.deepEqual(result, { comparable: true, reason: null })
  })

  test('stampScenario carries the scenario name and its own start time alongside run provenance', () => {
    const run = { repoSha: 'a'.repeat(40), repoDirty: false }
    const stamped = stampScenario(run, 'demo-scenario')
    assert.equal(stamped.scenarioName, 'demo-scenario')
    assert.equal(stamped.repoSha, run.repoSha)
    assert.match(stamped.startedAt, /^\d{4}-\d{2}-\d{2}T/)
  })
})
