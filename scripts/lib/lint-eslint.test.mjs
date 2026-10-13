import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { runResidual } from './lint-eslint.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')

test('stable ESLint bridge preserves warnings and fails invalid plugin configuration', async () => {
  const cwd = mkdtempSync(path.join(ROOT, '.lint-consumer-'))
  try {
    writeFileSync(path.join(cwd, 'case.js'), 'const unused = 1\n')
    const args = { cwd, files: ['case.js'], options: ['--max-warnings=0'], capture: true }
    const result = await runResidual({
      ...args,
      config: [{ files: ['**/*.js'], rules: { 'no-unused-vars': 'warn' } }],
    })
    assert.equal(result.exit, 1)
    assert.equal(JSON.parse(result.stdout)[0].warningCount, 1)
    assert.match(result.stderr, /maximum is 0/)
    await assert.rejects(
      runResidual({ ...args, config: [{ rules: { 'missing-plugin/rule': 'error' } }] }),
      /plugin|missing-plugin/
    )
    await assert.rejects(
      runResidual({ ...args, config: [{ plugins: { broken: null } }] }),
      /object|plugin/i
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
