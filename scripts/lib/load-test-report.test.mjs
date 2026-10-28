import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { compareCommits, comparison, report } from '../load-test/report.mjs'

test('commit identity requires complete valid object IDs; unknown is not a mismatch', () => {
  for (const size of [40, 64]) {
    assert.equal(compareCommits('a'.repeat(size), 'A'.repeat(size)), 'same')
    assert.equal(compareCommits('a'.repeat(size), 'b'.repeat(size)), 'different')
  }
  for (const value of [
    undefined,
    null,
    '',
    'unknown',
    'abc',
    'g'.repeat(40),
    '0'.repeat(40),
    'a'.repeat(41),
  ]) {
    assert.equal(compareCommits(value, value), 'unknown')
    assert.equal(compareCommits('a'.repeat(40), value), 'unknown')
    assert.equal(compareCommits(value, 'a'.repeat(40)), 'unknown')
  }
})

const result = (cls, offeredRate, achievedRate, serverP95Ms) => ({
  class: cls,
  reasons: [],
  figures: { offeredRate, achievedRate, serverP95Ms },
})

test('reference comparison uses the published upper bound and the achieved rate', () => {
  assert.equal(comparison('r5-1', result('valid', 5, 5, 20)), 'within (≤ 32 ms)')
  assert.equal(comparison('r10-2', result('valid', 10, 9.5, 20)), 'outside (bound 35 ms)')
  assert.equal(comparison('r20-1', result('valid', 20, 20, 950)), 'outside (bound 900 ms)')
  assert.equal(comparison('r30-1', result('valid', 30, 30, 100)), '—')
  assert.equal(comparison('r5-1', result('invalid measurement', 5, 5, 20)), '—')
  assert.equal(comparison('control', result('valid', 5, 5, 20)), '—')
})

test('report lists every step, stamps smoke runs and keeps a missing result visible', () => {
  const d = mkdtempSync(join(tmpdir(), 'lt-report-'))
  mkdirSync(join(d, 'steps/r5-1'), { recursive: true })
  mkdirSync(join(d, 'steps/r10-1'), { recursive: true })
  writeFileSync(join(d, 'steps/r5-1/result.json'), JSON.stringify(result('valid', 5, 5, 20)))
  writeFileSync(
    join(d, 'host-manifest.txt'),
    `commit=${'a'.repeat(40)}\nrun_id=lt1\nharness_sha256=h1\nswap=off\ncontainer=x-api-1 image=api digest=sha256:1 mem_limit=0 nano_cpus=0\n`
  )
  writeFileSync(join(d, 'generator-manifest.txt'), `commit=${'a'.repeat(40)}\nharness_sha256=h2\n`)
  const text = report(d, 'smoke')
  assert.match(text, /not the reference protocol; never compare it with capacity.md/)
  assert.match(text, /Run `lt1`/)
  assert.match(text, /same commit as the host: yes; same harness: NO/)
  assert.match(text, /\| r5-1 \| valid \|/)
  assert.match(text, /\| r10-1 \| invalid measurement \|.*result missing/)
  assert.ok(text.indexOf('r5-1') < text.indexOf('r10-1'), 'numeric step order')
  const manifest = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'))
  assert.equal(manifest.referenceProtocol, false)
  assert.equal(manifest.sameHarness, false)
  assert.equal(manifest.containers[0].digest, 'sha256:1')
})

test('JSON and report distinguish unknown revision from an actual mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-report-identity-'))
  for (const [host, generator, expected, text] of [
    ['unknown', 'unknown', 'unknown', 'unknown (not verified)'],
    [undefined, undefined, 'unknown', 'unknown (not verified)'],
    ['not-a-commit', 'not-a-commit', 'unknown', 'unknown (not verified)'],
    ['a'.repeat(40), 'b'.repeat(40), 'different', 'NO'],
    ['a'.repeat(40), 'a'.repeat(40), 'same', 'yes'],
  ]) {
    writeFileSync(join(dir, 'host-manifest.txt'), host ? `commit=${host}\n` : '')
    writeFileSync(join(dir, 'generator-manifest.txt'), generator ? `commit=${generator}\n` : '')
    const output = report(dir, 'smoke')
    const json = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    assert.equal(json.commitComparison, expected)
    assert.equal(json.sameCommit, expected === 'same')
    assert.ok(output.includes(`same commit as the host: ${text};`))
    assert.equal(json.host.commit, host)
  }
})
