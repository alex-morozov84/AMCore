import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { api, jest } from '../api-e2e/paths.mjs'

// Override only roots to isolate synthetic files; use the actual installed runner/config.
test('ordinary nested API additions enter native discovery and exactly one partition', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amcore-test-discovery-'))
  try {
    mkdirSync(join(directory, 'test/nested'), { recursive: true })
    const names = [
      'test/first.e2e-spec.ts',
      'test/second.e2e-spec.ts',
      'test/nested/new.e2e-spec.ts',
    ]
    for (const name of names) writeFileSync(join(directory, name), "test('ordinary', () => {})\n")
    writeFileSync(join(directory, 'test/unit.spec.ts'), "test('unit', () => {})\n")
    const discover = (shard) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--experimental-vm-modules',
            jest,
            '--config',
            'jest-e2e.config.js',
            '--runInBand',
            '--roots',
            directory,
            '--listTests',
            '--json',
            ...(shard ? [`--shard=${shard}`] : []),
          ],
          { cwd: api, encoding: 'utf8' }
        )
      )
    const full = discover()
    assert.deepEqual(full.sort(), names.map((name) => join(directory, name)).sort())
    const partition = ['1/3', '2/3', '3/3'].flatMap(discover)
    assert.deepEqual(partition.sort(), full)
    assert.equal(new Set(partition).size, full.length)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('extension commands retain explicit selected inventory and copied preparation', () => {
  const copy = readFileSync('scripts/fixtures/notification-ai-extension-contracts.sh', 'utf8')
  const selected = copy.match(/test\/[^\s]+\.e2e-spec\.ts/g)
  assert.equal(selected.length, 9)
  assert.equal(new Set(selected).size, 9)
  assert.match(copy, /pnpm run build/)
  assert.match(copy, /prisma generate/)
  assert.match(copy, /pnpm run typecheck/)
  assert.match(copy, /--runInBand/)
  // The explicit list is a distinct boundary: another stock file does not join it automatically.
  assert.ok(!selected.includes('test/nested/new.e2e-spec.ts'))
  const extendedScript = copy.replace(
    'test/openapi.e2e-spec.ts)',
    'test/openapi.e2e-spec.ts test/nested/new.e2e-spec.ts)'
  )
  assert.notEqual(extendedScript, copy)
  const extended = extendedScript.match(/test\/[^\s]+\.e2e-spec\.ts/g)
  assert.equal(extended.length, 10)
  assert.equal(new Set(extended).size, 10)
  assert.ok(extended.includes('test/nested/new.e2e-spec.ts'))
  const capability = readFileSync('scripts/fixtures/t024-capability-extension.sh', 'utf8')
  assert.match(capability, /t024-capability-extension.patch/)
  assert.match(capability, /PATH=/)
})
