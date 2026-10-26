import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { comparison, report } from '../load-test/report.mjs'

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
    'commit=abc\nrun_id=lt1\nharness_sha256=h1\nswap=off\ncontainer=x-api-1 image=api digest=sha256:1 mem_limit=0 nano_cpus=0\n'
  )
  writeFileSync(join(d, 'generator-manifest.txt'), 'commit=abc\nharness_sha256=h2\n')
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
