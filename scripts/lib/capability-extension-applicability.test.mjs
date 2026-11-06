import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function probe(t, context, args = [], repository = 'example/product', gitStatus = 1) {
  const root = mkdtempSync(join(tmpdir(), 'capability-applicability-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts/fixtures'), { recursive: true })
  mkdirSync(join(root, 'bin'))
  copyFileSync(
    'scripts/fixtures/t024-capability-extension.sh',
    join(root, 'scripts/fixtures/run.sh')
  )
  writeFileSync(join(root, 'PROJECT_CONTEXT.md'), context)
  // A failed patch is independent of source anchors. Copy/build/test commands are unavailable.
  writeFileSync(
    join(root, 'bin/git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$PROBE_GIT_LOG"\nexit ${gitStatus}\n`,
    { mode: 0o755 }
  )
  const summary = join(root, 'summary')
  const log = join(root, 'git-log')
  const result = spawnSync('bash', [join(root, 'scripts/fixtures/run.sh'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
      TMPDIR: join(root, 'no-copy-directory'),
      GITHUB_REPOSITORY: repository,
      GITHUB_STEP_SUMMARY: summary,
      PROBE_GIT_LOG: log,
    },
  })
  return {
    ...result,
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
    git: existsSync(log) ? readFileSync(log, 'utf8') : '',
  }
}

for (const [label, context] of [
  ['starter', '- **Mode:** `upstream-starter`\n'],
  ['misspelled mode', '- **Mode:** `downstream-produc`\n'],
  ['duplicate mode', '- **Mode:** `downstream-product`\n- **Mode:** `downstream-product`\n'],
  ['conflicting mode', '- **Mode:** `downstream-product`\n- **Mode:** `upstream-starter`\n'],
]) {
  test(`${label} retains the failing patch check`, (t) => {
    const result = probe(t, context, ['--check-only'])
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.git, /apply --check/)
    assert.equal(result.summary, '')
    assert.doesNotMatch(result.stdout, /::warning::/)
  })
}

for (const args of [[], ['--check-only']]) {
  test(`product warns before copy or patch, args=${args}`, (t) => {
    const result = probe(t, '- **Mode:** `downstream-product`\n', args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.git, '')
    assert.match(result.stdout, /::warning::Capability extension did not run/)
    assert.match(result.summary, /A green Test no longer proves/)
    assert.match(result.summary, /roles, organizations, rows, DENY, fields and API keys/)
  })
}

test('canonical AMCore cannot disable its proof by changing Mode', (t) => {
  const result = probe(t, '- **Mode:** `downstream-product`\n', [], 'alex-morozov84/AMCore')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /::error::AMCore must retain Mode upstream-starter/)
  assert.equal(result.summary, '')
})

test('starter check-only accepts an applying patch without copying', (t) => {
  const result = probe(
    t,
    '- **Mode:** `upstream-starter`\n',
    ['--check-only'],
    'example/product',
    0
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.git, /apply --check/)
  assert.equal(result.summary, '')
})
