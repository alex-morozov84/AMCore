import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureRepo, git, readFixtureFile } from './lib/test-fixture.mjs'

const INIT_PRODUCT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-product.mjs')

// Enum/newline rejection happens in collectAnswers(), before verify() would
// ever run — no AMCORE_INIT_SKIP_VERIFY needed for those. The
// failed-verification test explicitly opts into AMCORE_INIT_FAKE_VERIFY_FAIL
// instead of skipping verification, since that's the exact path it tests.
function runInitProduct(root, args, extraEnv = {}) {
  return spawnSync('node', [INIT_PRODUCT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', AMCORE_INIT_ROOT: root, ...extraEnv },
  })
}

let fixture

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('init-product input validation', () => {
  test('requires a default-language name before planning a fresh scripted setup', () => {
    fixture = createFixtureRepo()
    const before = readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md')
    for (const consent of ['--dry-run', '--yes']) {
      const result = runInitProduct(fixture.root, [
        '--non-interactive',
        '--ci-mode',
        'heavy-off',
        consent,
      ])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Enter a product name for the default site language/)
      assert.equal(readFixtureFile(fixture.root, 'PROJECT_CONTEXT.md'), before)
    }
  })

  test('rejects an out-of-range enum flag before building a plan', () => {
    fixture = createFixtureRepo()
    const result = runInitProduct(fixture.root, ['--yes', '--theme-mode=neon'])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--theme-mode=neon is not one of: system, light, dark/)
    assert.doesNotMatch(readFixtureFile(fixture.root, 'apps/web/src/shared/lib/theme.ts'), /neon/)
  })

  test('rejects an invalid npm package name before building a plan', () => {
    fixture = createFixtureRepo()
    const result = runInitProduct(fixture.root, ['--dry-run', '--package-name=Bad Name!'])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--package-name=Bad Name! is not a valid npm package name/)
    assert.doesNotMatch(readFixtureFile(fixture.root, 'package.json'), /Bad Name!/)
  })

  for (const reserved of ['node_modules', 'favicon.ico']) {
    test(`rejects the reserved npm package name "${reserved}" before building a plan`, () => {
      fixture = createFixtureRepo()
      const result = runInitProduct(fixture.root, ['--dry-run', `--package-name=${reserved}`])

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /is not a valid npm package name/)
      assert.doesNotMatch(
        readFixtureFile(fixture.root, 'package.json'),
        new RegExp(`"name": "${reserved}"`)
      )
    })
  }

  test('rejects a newline embedded in a single-line answer', () => {
    fixture = createFixtureRepo()
    const result = runInitProduct(fixture.root, [
      '--yes',
      '--product-name=Acme\nMode: downstream-product',
    ])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /"productName" cannot contain a newline/)
  })

  test('keeps a custom Git URL independent of the team process and retains a missing path', () => {
    fixture = createFixtureRepo()
    const { root } = fixture
    const context = 'PROJECT_CONTEXT.md'
    const guide = 'Наш процесс.md'
    const oldRules = 'https://example.test/git-rules'
    const apply = (args) => {
      const result = runInitProduct(root, ['--yes', ...args], { AMCORE_INIT_SKIP_VERIFY: '1' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout
    }
    const commit = () => {
      git(root, ['add', '-A'])
      git(root, [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '-qm',
        'fixture',
      ])
    }

    // Exercise a legacy product with no Team process field.
    writeFileSync(
      path.join(root, context),
      readFixtureFile(root, context)
        .replace('upstream-starter', 'downstream-product')
        .replace(
          '- **Workflow mode:** `strict` (protected main).',
          `- **Workflow mode:** \`custom\`\n- **Workflow reference:** ${oldRules}`
        )
    )
    writeFileSync(path.join(root, guide), '# Team rules\n')
    commit()
    assert.match(apply(['--workflow-mode', 'custom']), /Team process: AMCore/)
    assert.doesNotMatch(readFixtureFile(root, context), /Team process/)
    commit()

    const args = ['--team-process', `file:${guide}`]
    const before = readFixtureFile(root, context)
    const preview = runInitProduct(root, ['--dry-run', ...args])
    assert.equal(preview.status, 0, preview.stderr)
    assert.match(preview.stdout, /file:Наш процесс\.md/)
    assert.equal(readFixtureFile(root, context), before)
    apply(args)
    assert.equal(git(root, ['diff', '--name-only']).trim(), context)
    assert.match(
      readFixtureFile(root, context),
      /Workflow reference:.*https:\/\/example\.test\/git-rules/
    )
    commit()

    git(root, ['mv', guide, 'New rules.md'])
    commit()
    assert.match(apply([]), /file unavailable or invalid/)
    assert.match(readFixtureFile(root, context), /file:Наш процесс\.md/)
    apply(['--team-process', 'file:New rules.md'])
    assert.match(readFixtureFile(root, context), /file:New rules\.md/)
  })

  test('rejects nonportable and untracked team rules before any product writes', () => {
    fixture = createFixtureRepo()
    const { root } = fixture
    const before = readFixtureFile(root, 'PROJECT_CONTEXT.md')
    writeFileSync(path.join(root, 'untracked.md'), '# Rules\n')
    symlinkSync('/tmp', path.join(root, 'escape'))
    for (const value of [
      'file:https://example.test/rules.md',
      'file:/tmp/rules.md',
      'file:../rules.md',
      'file:escape/rules.md',
      'file:untracked.md',
      'file:rules.md\nInjected field',
    ]) {
      const result = runInitProduct(root, [
        '--product-name',
        'Shop',
        '--dry-run',
        '--team-process',
        value,
      ])
      assert.notEqual(result.status, 0, value)
      assert.match(result.stderr, /tracked Markdown file/)
      assert.equal(readFixtureFile(root, 'PROJECT_CONTEXT.md'), before)
    }
  })

  test('reports a failed post-apply verification and exits non-zero', () => {
    fixture = createFixtureRepo()
    const result = runInitProduct(fixture.root, ['--yes', "--product-name=Bob's App"], {
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
