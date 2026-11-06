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

const source = new URL('../', import.meta.url)
const readJson = (path) => JSON.parse(readFileSync(new URL(path, source), 'utf8'))
const main = readJson('.github/rulesets/main.json')
const tags = readJson('.github/rulesets/tags-release.json')
const downstream = '- **Mode:** `downstream-product`\n'

function fixture(t, context = '- **Mode:** `upstream-starter`\n') {
  const root = mkdtempSync(join(tmpdir(), 'amcore-security-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['scripts', '.github/rulesets', 'bin', 'temp'])
    mkdirSync(join(root, dir), { recursive: true })
  for (const path of [
    'scripts/setup-repo-security.sh',
    '.github/rulesets/main.json',
    '.github/rulesets/tags-release.json',
  ]) {
    copyFileSync(new URL(path, source), join(root, path))
  }
  if (context !== null) writeFileSync(join(root, 'PROJECT_CONTEXT.md'), context)
  const log = join(root, 'calls.jsonl')
  writeFileSync(
    join(root, 'bin/gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
const payload = input ? JSON.parse(fs.readFileSync(input === '-' ? 0 : input, 'utf8')) : null;
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({args,input,payload}) + '\\n');
if (args[0] === 'auth') process.exit(0);
if (args[0] === 'repo') { console.log(JSON.stringify({nameWithOwner:'example/product'})); process.exit(0); }
if (args.includes(process.env.MOCK_FAIL)) process.exit(1);
if (args.includes('repos/example/product/rulesets') && !args.includes('--method')) {
  console.log(process.env.MOCK_EXISTING ? JSON.stringify([
    {id:11, name:'Protect main', source_type:'Repository'},
    {id:12, name:'Protect release tags', source_type:'Repository'}
  ]) : '[]');
} else console.log('{}');
`,
    { mode: 0o755 }
  )
  const run = (args = [], extra = {}) => {
    writeFileSync(log, '')
    const result = spawnSync('bash', ['scripts/setup-repo-security.sh', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        TMPDIR: join(root, 'temp'),
        MOCK_LOG: log,
        ...extra,
      },
    })
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    return { ...result, calls }
  }
  return { root, run }
}

function assertProfile(result, allowMerge) {
  assert.equal(result.status, 0, result.stderr)
  const patch = result.calls.find((call) => call.args.includes('PATCH')).payload
  assert.deepEqual(patch, {
    allow_squash_merge: true,
    allow_merge_commit: allowMerge,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
    },
  })
  const payloads = result.calls.filter((call) => call.payload?.rules).map((call) => call.payload)
  const expected = readJson('.github/rulesets/main.json')
  if (allowMerge) {
    expected.rules = expected.rules.filter((rule) => rule.type !== 'required_linear_history')
    expected.rules.find((rule) => rule.type === 'pull_request').parameters.allowed_merge_methods = [
      'squash',
      'merge',
    ]
  }
  assert.deepEqual(payloads, [expected, tags])
  for (const call of result.calls.filter((call) => call.input && call.input !== '-')) {
    if (allowMerge && call.payload.name === main.name) assert.equal(existsSync(call.input), false)
  }
}

test('default upstream profile stays squash-only with unrelated security fields intact', (t) => {
  assertProfile(fixture(t).run(), false)
})

test('downstream opt-in derives merge profile without changing source rules; reruns preserve it', (t) => {
  const f = fixture(t, downstream)
  assertProfile(f.run(['--fork-updates']), true)
  assertProfile(f.run(['--fork-updates'], { MOCK_EXISTING: '1' }), true)
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, '.github/rulesets/main.json'), 'utf8')),
    main
  )
})

test('downstream default warns before any network request and restores squash-only', (t) => {
  const f = fixture(t, downstream)
  const result = f.run()
  assertProfile(result, false)
  assert.match(result.stderr, /WARNING.*restores squash-only/)
  // The auth refusal still receives the warning; no API mutation can precede it.
  writeFileSync(join(f.root, 'bin/gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const refused = f.run()
  assert.match(refused.stderr, /WARNING[\s\S]*gh auth status failed/)
})

test('bad flags and ambiguous/non-product contexts refuse before any gh call', (t) => {
  for (const args of [
    ['--unknown'],
    ['--fork-updates=yes'],
    ['--fork-updates', '--fork-updates'],
  ]) {
    const result = fixture(t, downstream).run(args)
    assert.equal(result.status, 1)
    assert.deepEqual(result.calls, [])
  }
  for (const context of [
    null,
    '',
    '- **Mode:** `upstream-starter`\n',
    downstream + downstream,
    '- **Mode:** downstream-product\n',
  ]) {
    const result = fixture(t, context).run(['--fork-updates'])
    assert.equal(result.status, 1)
    assert.deepEqual(result.calls, [])
  }
})

test('API failure is not silently downgraded and the temporary ruleset is removed', (t) => {
  const f = fixture(t, downstream)
  const result = f.run(['--fork-updates'], { MOCK_FAIL: 'repos/example/product/rulesets' })
  assert.equal(result.status, 1)
  assert.equal(result.calls.filter((call) => call.args.includes('PATCH')).length, 1)
  const files = spawnSync('ls', ['-A', join(f.root, 'temp')], { encoding: 'utf8' })
  assert.equal(files.stdout, '')
})
