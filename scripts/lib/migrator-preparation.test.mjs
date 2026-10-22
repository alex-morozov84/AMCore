import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { context } from '../migrator-preparation/context.mjs'

test('positive hook control rejects missing trace and parses real newline-delimited evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'migrator-preparation-reader-'))
  try {
    const fixture = context(directory)
    const checker = readFileSync(join(fixture, 'verification/check-control.cjs'), 'utf8')
    const execute = (trace) =>
      runInNewContext(checker, {
        require: (name) =>
          name === 'node:assert/strict'
            ? assert
            : {
                readFileSync: (path) =>
                  path.endsWith('/trace.jsonl') ? trace : '{"hook":"positive-control:prepare"}\n',
              },
      })
    execute(
      '{"name":"prisma","event":"preinstall"}\n{"name":"amcore-hook-control","event":"prepare"}\n'
    )
    assert.throws(() => execute('{"name":"prisma","event":"preinstall"}\n'), assert.AssertionError)
    const emitted = []
    const fs = {
      readFileSync: () => '{"name":"amcore-hook-control"}',
      appendFileSync: (path, value) => emitted.push({ path, value }),
    }
    runInNewContext(readFileSync(join(fixture, 'verification/trace.cjs'), 'utf8'), {
      require: () => fs,
      process: { env: { npm_lifecycle_event: 'prepare' } },
    })
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].value.endsWith('\n'), true)
    assert.deepEqual(JSON.parse(emitted[0].value), {
      name: 'amcore-hook-control',
      event: 'prepare',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
