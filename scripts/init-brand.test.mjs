import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureRepo, readFixtureFile, fakePng, git } from './lib/test-fixture.mjs'

const INIT_BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-brand.mjs')

const BASE_FLAGS = [
  '--yes',
  '--product-name=Acme',
  '--product-description=A new tagline.',
  '--purpose=Ship Acme things.',
  '--upstream-sync-policy=Rebase onto upstream/main quarterly.',
  '--workflow-mode=flexible',
  '--theme-mode=dark',
  '--theme-persistence=cookie-ssr',
]

function runInitBrand(root, args) {
  return spawnSync('node', [INIT_BRAND, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AMCORE_INIT_ROOT: root },
  })
}

let fixture

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('init-brand (end-to-end against a disposable fixture)', () => {
  test('--dry-run writes nothing', () => {
    fixture = createFixtureRepo()
    const before = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')

    const result = runInitBrand(fixture.root, ['--dry-run', ...BASE_FLAGS])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /--dry-run: no files were written/)
    assert.equal(readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'), before)
    assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '')
  })

  test('apply updates every target file as expected', () => {
    fixture = createFixtureRepo()

    const result = runInitBrand(fixture.root, BASE_FLAGS)
    assert.equal(result.status, 0, result.stderr)

    const context = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')
    assert.match(context, /- \*\*Mode:\*\* `downstream-product`/)
    assert.match(context, /- \*\*Product:\*\* Acme/)
    assert.match(context, /- \*\*Upstream sync policy:\*\* Rebase onto upstream\/main quarterly\./)
    assert.match(context, /- \*\*Workflow mode:\*\* `flexible`/)

    const manifest = readFixtureFile(fixture.root, 'apps/web/src/app/manifest.ts')
    assert.match(manifest, /name: 'Acme',/)
    assert.match(manifest, /short_name: 'Acme',/)
    assert.match(manifest, /description: 'A new tagline\.',/)

    const theme = readFixtureFile(fixture.root, 'apps/web/src/shared/lib/theme.ts')
    assert.match(theme, /DEFAULT_THEME_SETTING: ThemeSetting = 'dark'/)

    const en = JSON.parse(readFixtureFile(fixture.root, 'apps/web/messages/en.json'))
    assert.equal(en.meta.title, 'Acme')
    assert.equal(en.meta.description, 'A new tagline.')

    const ru = JSON.parse(readFixtureFile(fixture.root, 'apps/web/messages/ru.json'))
    assert.equal(ru.meta.title, 'Acme')
    assert.equal(
      ru.meta.description,
      'Стартовый шаблон.',
      'ru description must not be silently overwritten'
    )
  })

  test('re-running with the same answers is a safe no-op', () => {
    fixture = createFixtureRepo()

    const first = runInitBrand(fixture.root, BASE_FLAGS)
    assert.equal(first.status, 0, first.stderr)
    git(fixture.root, ['add', '-A'])
    git(fixture.root, [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-m',
      'apply brand',
      '--quiet',
    ])

    const contextAfterFirst = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')

    const second = runInitBrand(fixture.root, BASE_FLAGS)
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /Nothing to do — every value already matches\./)
    assert.equal(
      readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'),
      contextAfterFirst,
      'no duplicated fields on re-run'
    )
    assert.equal(
      git(fixture.root, ['status', '--porcelain']).trim(),
      '',
      'second run wrote nothing new'
    )
  })

  test('re-running with a changed answer only updates that field', () => {
    fixture = createFixtureRepo()
    runInitBrand(fixture.root, BASE_FLAGS)
    git(fixture.root, ['add', '-A'])
    git(fixture.root, [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-m',
      'apply brand',
      '--quiet',
    ])

    const second = runInitBrand(fixture.root, ['--yes', '--product-name=Acme']) // only re-set productName
    assert.equal(second.status, 0, second.stderr)

    const context = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')
    assert.match(context, /- \*\*Product:\*\* Acme/)
    // Fields not answered this run stay exactly as the first run left them.
    assert.match(context, /- \*\*Workflow mode:\*\* `flexible`/)
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
