import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'

import { createLintFixture } from './lint-fixture.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')

for (const fail of [false, true]) {
  test(`lint probes stay outside live source and clean up after ${fail ? 'failure' : 'success'}`, (t) => {
    const fixture = createLintFixture()
    let probe
    try {
      assert.ok(!fixture.root.startsWith(`${ROOT}${path.sep}`))
      t.mock.method(childProcess, 'spawnSync', (_binary, args, options) => {
        assert.equal(options.cwd, path.join(fixture.root, 'apps/web'))
        assert.equal(args[0], path.join(fixture.root, 'scripts/lint.mjs'))
        const relative = args.at(-1)
        probe = path.join(options.cwd, relative)
        assert.equal(readFileSync(probe, 'utf8'), 'export const probe = 1\n')
        assert.equal(existsSync(path.join(ROOT, 'apps/web', relative)), false)
        if (fail) return { status: 2, stderr: 'controlled failure' }
        return {
          status: 0,
          stdout: JSON.stringify({
            engines: [
              { engine: 'oxlint', stdout: JSON.stringify({ number_of_files: 1, diagnostics: [] }) },
              { engine: 'eslint', stdout: '[]' },
            ],
          }),
        }
      })
      syncBuiltinESMExports()
      const run = () => fixture.lint('export const probe = 1\n', 'src/_pages/auth/probe.ts')
      if (fail) assert.throws(run, /controlled failure/)
      else assert.deepEqual(run(), [])
      assert.ok(probe)
      assert.equal(existsSync(probe), false)
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
      fixture.cleanup()
    }
    assert.equal(existsSync(fixture.root), false)
  })
}
