import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/security-scans.yml', import.meta.url), 'utf8')
)
const job = workflow.jobs.osv
const scan = job.steps.find((step) => step.name === 'Scan repository with OSV-Scanner')

test('OSV keeps weekly recursive SARIF reporting and verified binary installation', () => {
  assert.equal(job.if, "github.event_name == 'schedule'")
  assert.ok(workflow.on.schedule.some((item) => item.cron === '43 3 * * 1'))
  assert.equal(job.permissions['security-events'], 'write')
  assert.equal(scan.if, undefined)
  assert.equal(scan['continue-on-error'], undefined)
  assert.match(
    scan.run,
    /osv-scanner scan --recursive --format sarif --output-file osv-results\.sarif \./
  )
  const install = job.steps.find((step) => step.name === 'Install OSV-Scanner')
  assert.match(install.env.OSV_SCANNER_VERSION, /^\d+\.\d+\.\d+$/)
  assert.match(install.env.OSV_SCANNER_LINUX_AMD64_SHA256, /^[a-f0-9]{64}$/)
  assert.match(install.run, /sha256sum -c -/)
  const upload = job.steps.find((step) => step.name === 'Upload OSV SARIF')
  assert.match(upload.uses, /^github\/codeql-action\/upload-sarif@[a-f0-9]{40}$/)
  assert.equal(upload.with.sarif_file, 'osv-results.sarif')
  assert.equal(upload.with.category, 'osv-scanner')
  assert.equal(upload.if, undefined)
  assert.equal(upload['continue-on-error'], undefined)
})

test('actual workflow shell accepts findings but rejects operational failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amcore-osv-status-'))
  try {
    writeFileSync(join(directory, 'osv-scanner'), '#!/bin/sh\nexit "$OSV_FIXTURE_EXIT"\n', {
      mode: 0o755,
    })
    for (const code of [0, 1, 2, 127, 128, 129, 130]) {
      const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', scan.run], {
        cwd: directory,
        env: { ...process.env, PATH: directory, OSV_FIXTURE_EXIT: String(code) },
        timeout: 5000,
      })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.equal(result.status, code <= 1 ? 0 : code, `scanner exit ${code}`)
    }
    const missing = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', scan.run], {
      cwd: directory,
      env: { ...process.env, PATH: join(directory, 'missing') },
      timeout: 5000,
    })
    assert.equal(missing.status, 127)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
