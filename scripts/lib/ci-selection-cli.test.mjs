import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const command = join(import.meta.dirname, '../ci-selection.mjs')
const areas = [
  'all',
  'docs',
  'ui',
  'web',
  'api',
  'apiE2e',
  'common',
  'infra',
  'monitoring',
  'tools',
  'email',
  'deployment',
]

test('selector binds plans to the actual Git merge and preserves the active policy', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-selection-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const put = (file, value) => {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), value)
  }
  const commit = () => {
    git('add', '.')
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const policy = (mode) => put('ci/product.json', JSON.stringify({ version: 1, mode }))
  put('PROJECT_CONTEXT.md', '- **Mode:** `downstream-product`\n')
  policy('normal')
  const base = commit()

  const invoke = (event, payload, files = {}, override = {}) => {
    const path = join(root, '.git/event.json')
    writeFileSync(path, JSON.stringify(payload))
    return spawnSync(process.execPath, [command], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_PATH: path,
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: git('rev-parse', 'HEAD'),
        GITHUB_REPOSITORY: 'example/product',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        CI_FILTER_OUTPUTS: JSON.stringify(
          Object.fromEntries(
            areas.map((name) => [name + '_files', JSON.stringify(files[name] ?? [])])
          )
        ),
        ...override,
      },
    })
  }
  const plan = (result) => {
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const modelPr = (from, head) => {
    const merge = git(
      'commit-tree',
      git('rev-parse', `${head}^{tree}`),
      '-p',
      from,
      '-p',
      head,
      '-m',
      'PR merge'
    )
    git('switch', '-q', '--detach', merge)
    return { pull_request: { base: { sha: from }, head: { sha: head } } }
  }
  const api = 'apps/api/test/new.e2e-spec.ts'
  const browser = 'apps/web/e2e/real-stack/new.spec.ts'
  const guard = 'apps/api/src/core/auth/refresh-token.guard.ts'
  const unknown = 'product-ops.toml'
  for (const example of [
    {
      files: { all: [api], api: [api], apiE2e: [api] },
      yes: ['api-e2e'],
      no: ['web-e2e', 'test-redis', 'docker-image-smoke', 'storybook'],
    },
    {
      files: { all: [guard, browser], api: [guard], web: [browser], common: [browser] },
      yes: ['api-e2e', 'web-e2e', 'test-redis'],
      no: [],
    },
    {
      files: { all: [api, unknown], api: [api], apiE2e: [api] },
      yes: ['api-e2e', 'web-e2e', 'test-email', 'deployment-version'],
      no: [],
    },
  ]) {
    git('switch', '-q', '--detach', base)
    for (const file of example.files.all) put(file, 'fixture')
    const head = commit()
    const event = modelPr(base, head)
    const actual = plan(invoke('pull_request', event, example.files))
    for (const job of example.yes) assert.ok(actual.effective.includes(job), job)
    for (const job of example.no) assert.ok(!actual.effective.includes(job), job)
    assert.ok(plan(invoke('pull_request', event, {})).effective.includes('web-e2e'))
    assert.match(
      invoke('pull_request', event, example.files, { GITHUB_SHA: head }).stderr,
      /checkout does not match/
    )
  }

  const unsupported = 'apps/api/src/example.e2e-spec.ts'
  git('switch', '-q', '--detach', base)
  put(unsupported, 'fixture')
  const legacy = commit()
  const oldPathOnly = { all: [unsupported], api: [unsupported] }
  const rejected = invoke('pull_request', modelPr(base, legacy), oldPathOnly)
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /Unsupported API E2E test placement: apps\/api\/src/)
  for (const destination of [null, api]) {
    git('switch', '-q', '--detach', legacy)
    git('rm', unsupported)
    if (destination) put(destination, 'fixture')
    const changed = destination ? [unsupported, destination] : [unsupported]
    const result = plan(
      invoke('pull_request', modelPr(legacy, commit()), {
        all: changed,
        api: changed,
        apiE2e: destination ? [destination] : [],
      })
    )
    assert.ok(result.effective.includes('api-e2e-plan'))
  }

  git('switch', '-q', '--detach', base)
  policy('heavy-off')
  const off = commit()
  const toOff = plan(invoke('pull_request', modelPr(base, off)))
  assert.ok(toOff.effective.includes('test-redis'))
  git('switch', '-q', '--detach', off)
  policy('normal')
  const back = commit()
  const toNormal = plan(invoke('pull_request', modelPr(off, back)))
  assert.ok(toNormal.effective.includes('test-unit'))
  for (const job of [
    'test-redis',
    'api-e2e',
    'web-e2e',
    'docker-image-smoke',
    'deployment-version',
  ])
    assert.ok(!toNormal.effective.includes(job), job)
  git('switch', '-q', '--detach', off)
  for (const event of ['push', 'schedule', 'release'])
    assert.equal(plan(invoke(event, {})).inputs.mode, 'heavy-off')
  assert.ok(
    plan(
      invoke('workflow_dispatch', { inputs: { 'full-once': true, 'source-sha': off } })
    ).effective.includes('test-redis')
  )
  assert.equal(plan(invoke('push', {})).inputs.mode, 'heavy-off')
  policy('full')
  commit()
  assert.equal(plan(invoke('push', {})).inputs.mode, 'full')
})
