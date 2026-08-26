import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureRepo, readFixtureFile, git } from './lib/test-fixture.mjs'

const INIT_BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-brand.mjs')

const BASE_FLAGS = [
  '--yes',
  "--product-name=Bob's App",
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
    env: { ...process.env, NODE_ENV: 'test', AMCORE_INIT_ROOT: root, AMCORE_INIT_SKIP_VERIFY: '1' },
  })
}

function commit(root, message) {
  git(root, ['add', '-A'])
  git(root, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-m',
    message,
    '--quiet',
  ])
}

let fixture

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('init-brand (end-to-end against a disposable fixture)', () => {
  test('--dry-run writes nothing and prints a unified diff', () => {
    fixture = createFixtureRepo()
    const before = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')

    const result = runInitBrand(fixture.root, ['--dry-run', ...BASE_FLAGS])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /--dry-run: no files were written/)
    assert.match(result.stdout, /^\s*--- .*PROJECT_CONTEXT\.md$/m)
    assert.match(result.stdout, /^\s*-- \*\*Product:\*\* AMCore$/m)
    assert.match(result.stdout, /^\s*\+- \*\*Product:\*\* Bob's App$/m)
    assert.equal(readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'), before)
    assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '')
  })

  test('apply updates every target file, correctly escaping a value containing an apostrophe', () => {
    fixture = createFixtureRepo()

    const result = runInitBrand(fixture.root, BASE_FLAGS)
    assert.equal(result.status, 0, result.stderr)

    const context = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')
    assert.match(context, /- \*\*Mode:\*\* `downstream-product`/)
    assert.match(
      context,
      /- \*\*Product:\*\* Bob's App$/m,
      'markdown field keeps the apostrophe literally'
    )
    assert.match(context, /- \*\*Upstream sync policy:\*\* Rebase onto upstream\/main quarterly\./)
    assert.match(context, /- \*\*Workflow mode:\*\* `flexible`/)

    const manifest = readFixtureFile(fixture.root, 'apps/web/src/app/manifest.ts')
    assert.match(
      manifest,
      /name: 'Bob\\'s App',/,
      'TS literal escapes the apostrophe, producing valid syntax'
    )
    assert.match(manifest, /short_name: 'Bob\\'s App',/)
    assert.match(manifest, /description: 'A new tagline\.',/)

    const theme = readFixtureFile(fixture.root, 'apps/web/src/shared/lib/theme.ts')
    assert.match(theme, /DEFAULT_THEME_SETTING: ThemeSetting = 'dark'/)

    const en = JSON.parse(readFixtureFile(fixture.root, 'apps/web/messages/en.json'))
    assert.equal(en.meta.title, "Bob's App")
    assert.equal(en.meta.description, 'A new tagline.')

    const ru = JSON.parse(readFixtureFile(fixture.root, 'apps/web/messages/ru.json'))
    assert.equal(ru.meta.title, "Bob's App")
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
    commit(fixture.root, 'apply brand')
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
    commit(fixture.root, 'apply brand')

    const second = runInitBrand(fixture.root, ['--yes', '--product-name=Acme'])
    assert.equal(second.status, 0, second.stderr)

    const context = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')
    assert.match(context, /- \*\*Product:\*\* Acme/)
    assert.match(
      context,
      /- \*\*Workflow mode:\*\* `flexible`/,
      'fields not answered this run are untouched'
    )
  })
})
