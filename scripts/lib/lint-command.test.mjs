import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '../..')
const fixture = path.join(ROOT, 'apps/api/src/lint-command space.fixture.ts')

function run(args) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lint.mjs'), ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return result
}

test('real paired command: foreign cwd, spaces, warnings, fixes and failures', () => {
  assert.equal(existsSync(fixture), false)
  try {
    writeFileSync(fixture, 'export const value: any = 1\n')
    assert.equal(run(['--scope', 'api', fixture]).status, 1)
    writeFileSync(fixture, '/* oxlint-disable no-console */\nexport const value = 1\n')
    assert.equal(run(['--scope', 'api', '--max-warnings=0', fixture]).status, 1)
    writeFileSync(fixture, 'export let value = 1\n')
    assert.equal(run(['--scope', 'api', '--fix', fixture]).status, 0)
    assert.match(readFileSync(fixture, 'utf8'), /export const value/)
    assert.equal(run(['--scope', 'api', '--max-warnings=0', fixture]).status, 0)
    writeFileSync(
      fixture,
      "import { Injectable } from '@nestjs/common'\nimport { EnvService } from './env/env.service'\n@Injectable()\nexport class Example { constructor(readonly env: EnvService) {} }\n"
    )
    const di = run(['--scope', 'api', '--fix', fixture])
    assert.equal(di.status, 0, di.stdout + di.stderr)
    assert.match(readFileSync(fixture, 'utf8'), /import \{ EnvService \}/)
    assert.doesNotMatch(readFileSync(fixture, 'utf8'), /import type|import \{ type EnvService/)

    assert.equal(run(['--scope', 'api', '--unknown', fixture]).status, 1)
    assert.equal(run(['--scope', 'unknown', fixture]).status, 1)
    assert.notEqual(run(['--scope', 'api', `${fixture}.missing`]).status, 0)
    writeFileSync(fixture, 'export const value = (\n')
    assert.equal(run(['--scope', 'api', fixture]).status, 1)
  } finally {
    unlinkSync(fixture)
  }
})
