import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureRepo, readFixtureFile, fakePng } from './lib/test-fixture.mjs'

const INIT_BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-brand.mjs')
const BASE_FLAGS = ['--yes', '--product-name=Acme']

function runInitBrand(root, args) {
  return spawnSync('node', [INIT_BRAND, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', AMCORE_INIT_ROOT: root, AMCORE_INIT_SKIP_VERIFY: '1' },
  })
}

let fixture

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('init-brand safety guards', () => {
  test('testability env vars are inert without NODE_ENV=test (no real-run backdoor)', () => {
    fixture = createFixtureRepo()
    const env = { ...process.env, AMCORE_INIT_ROOT: fixture.root, AMCORE_INIT_SKIP_VERIFY: '1' }
    delete env.NODE_ENV

    const result = spawnSync('node', [INIT_BRAND, '--dry-run', ...BASE_FLAGS], {
      encoding: 'utf8',
      env,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(
      result.stdout,
      new RegExp(fixture.root),
      'AMCORE_INIT_ROOT was ignored, as it should be'
    )
  })

  test('refuses to apply on a dirty working tree', () => {
    fixture = createFixtureRepo()
    writeFileSync(path.join(fixture.root, 'untracked.txt'), 'x')

    const result = runInitBrand(fixture.root, BASE_FLAGS)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /working tree is not clean/)
    assert.doesNotMatch(readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'), /Acme/)
  })

  test('refuses to apply when ai/ is present without the override token', () => {
    fixture = createFixtureRepo()
    mkdirSync(path.join(fixture.root, 'ai'))

    const result = runInitBrand(fixture.root, BASE_FLAGS)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /maintainer checkout/)
  })

  test('applies when ai/ is present and the exact override token is given', () => {
    fixture = createFixtureRepo()
    mkdirSync(path.join(fixture.root, 'ai'))

    const result = runInitBrand(fixture.root, [
      ...BASE_FLAGS,
      '--force-maintainer-checkout=i-understand-this-is-amcore-maintainer-checkout',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.match(readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'), /Acme/)
  })

  test('--dry-run is exempt from every guard, even in an ai/ checkout with a dirty tree', () => {
    fixture = createFixtureRepo()
    mkdirSync(path.join(fixture.root, 'ai'))
    writeFileSync(path.join(fixture.root, 'untracked.txt'), 'x')

    const result = runInitBrand(fixture.root, ['--dry-run', ...BASE_FLAGS])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /--dry-run: no files were written/)
  })

  test('copies a new logo and validates icon dimensions, failing closed on a mismatch', () => {
    fixture = createFixtureRepo()
    const assets = mkdtempSync(path.join(tmpdir(), 'amcore-init-brand-assets-'))
    try {
      const goodIcon = path.join(assets, 'new-icon-192.png')
      writeFileSync(goodIcon, fakePng(192, 192))
      const newLogo = path.join(assets, 'new-logo-dark.png')
      writeFileSync(newLogo, fakePng(64, 64))
      const wrongSizeIcon = path.join(assets, 'wrong-icon-512.png')
      writeFileSync(wrongSizeIcon, fakePng(100, 100))

      const good = runInitBrand(fixture.root, [
        '--yes',
        `--icon-192=${goodIcon}`,
        `--logo-dark=${newLogo}`,
      ])
      assert.equal(good.status, 0, good.stderr)
      const copiedLogo = readFileSync(path.join(fixture.root, 'apps/web/public/logo-dark.png'))
      assert.ok(
        copiedLogo.equals(readFileSync(newLogo)),
        'logo-dark.png was replaced with the supplied file'
      )

      const bad = runInitBrand(fixture.root, ['--yes', `--icon-512=${wrongSizeIcon}`])
      assert.notEqual(bad.status, 0)
      assert.match(bad.stderr, /expected 512x512/)
    } finally {
      rmSync(assets, { recursive: true, force: true })
    }
  })
})
