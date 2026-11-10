import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { knownReadiness } from '../runner-disk/probe.mjs'

const receipt = JSON.parse(readFileSync('scripts/runner-disk/known-readiness.json', 'utf8'))

test('effective readiness source/settings changes invalidate admission before dependencies exist', () => {
  for (const changed of [
    'apps/api/src/env/schema/observability.env.ts',
    'scripts/stand/config.mjs',
    'packages/shared/src/config/admin-console.json',
  ]) {
    const directory = mkdtempSync(join(tmpdir(), 'runner-readiness-'))
    try {
      for (const { path } of receipt) {
        const destination = join(directory, path)
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, readFileSync(path))
      }
      assert.equal(knownReadiness(directory), true)
      writeFileSync(join(directory, changed), 'changed effective configuration')
      assert.equal(knownReadiness(directory), false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
