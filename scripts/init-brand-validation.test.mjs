import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureRepo, readFixtureFile } from './lib/test-fixture.mjs'

const INIT_BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-brand.mjs')

// Enum/newline rejection happens in collectAnswers(), before verify() would
// ever run — no AMCORE_INIT_SKIP_VERIFY needed for those. The
// failed-verification test explicitly opts into AMCORE_INIT_FAKE_VERIFY_FAIL
// instead of skipping verification, since that's the exact path it tests.
function runInitBrand(root, args, extraEnv = {}) {
  return spawnSync('node', [INIT_BRAND, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', AMCORE_INIT_ROOT: root, ...extraEnv },
  })
}

let fixture

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('init-brand input validation', () => {
  test('rejects an out-of-range enum flag before building a plan', () => {
    fixture = createFixtureRepo()
    const result = runInitBrand(fixture.root, ['--yes', '--theme-mode=neon'])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--theme-mode=neon is not one of: system, light, dark/)
    assert.doesNotMatch(readFixtureFile(fixture.root, 'apps/web/src/shared/lib/theme.ts'), /neon/)
  })

  test('rejects an invalid npm package name before building a plan', () => {
    fixture = createFixtureRepo()
    const result = runInitBrand(fixture.root, ['--dry-run', '--package-name=Bad Name!'])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--package-name=Bad Name! is not a valid npm package name/)
    assert.doesNotMatch(readFixtureFile(fixture.root, 'package.json'), /Bad Name!/)
  })

  test('rejects a newline embedded in a single-line answer', () => {
    fixture = createFixtureRepo()
    const result = runInitBrand(fixture.root, [
      '--yes',
      '--product-name=Acme\nMode: downstream-product',
    ])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /"productName" cannot contain a newline/)
  })

  test('reports a failed post-apply verification and exits non-zero', () => {
    fixture = createFixtureRepo()
    const result = runInitBrand(fixture.root, ['--yes', "--product-name=Bob's App"], {
      AMCORE_INIT_FAKE_VERIFY_FAIL: '1',
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /- fake: FAILED/)
    assert.match(result.stdout, /boom/)
    assert.match(result.stdout, /Verification failed/)
    assert.match(
      readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'),
      /Bob's App/,
      'the write itself still happened'
    )
  })
})
