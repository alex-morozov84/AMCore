import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyForkInitialization } from './ci-fork-initialization.mjs'

test('first fork PR requires the published source and permits only initialization', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-fork-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const put = (path, text) => writeFileSync(join(root, path), text)
  put('PROJECT_CONTEXT.md', '- **Mode:** `upstream-starter`\n')
  git('config', 'commit.gpgsign', 'false')
  execFileSync('mkdir', [join(root, 'scripts'), join(root, 'ci')])
  put('ci/product.json', '{"version":1,"mode":"normal"}')
  put('package.json', '{"name":"amcore","description":"starter","scripts":{"test":"node --test"}}')
  git('add', '.')
  git('commit', '-qm', 'starter')
  const oldBase = git('rev-parse', 'HEAD')
  put('scripts/verify-first-product-pr.mjs', '// capability shipped by the supported release')
  git('add', '.')
  git('commit', '-qm', 'supported release')
  let base = git('rev-parse', 'HEAD')
  const repository = 'fixture/fork'
  const canonical = 'alex-morozov84/AMCore'
  const responses = {
    [repository]: { id: 2, fork: true, parent: { id: 1 }, source: { id: 1 } },
    [canonical]: { id: 1, full_name: canonical },
    [`${canonical}/releases/tags/v1.0.0`]: { tag_name: 'v1.0.0', draft: false, prerelease: false },
    [`${canonical}/commits/v1.0.0`]: { sha: base },
    [`${repository}/git/ref/heads/main`]: { object: { sha: base } },
  }
  t.mock.method(globalThis, 'fetch', async (url) => {
    const result = responses[new URL(url).pathname.slice('/repos/'.length)]
    return new Response(JSON.stringify(result ?? {}), { status: result ? 200 : 404 })
  })
  const commitPr = (script) => {
    put(
      'PROJECT_CONTEXT.md',
      '- **Mode:** `downstream-product`\n- **initialized_from_amcore_version:** v1.0.0\n'
    )
    put(
      'package.json',
      JSON.stringify({ name: 'product', description: 'fixture', scripts: { test: script } })
    )
    git('add', '.')
    const tree = git('write-tree')
    const head = git('commit-tree', tree, '-p', base, '-m', 'init product')
    const checkout = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'PR checkout')
    git('checkout', '-q', checkout)
    return {
      payload: {
        pull_request: {
          base: { sha: base, ref: 'main', repo: { id: 2 } },
          head: { sha: head, repo: { id: 2 } },
        },
      },
      env: {
        GITHUB_API_URL: 'https://api.example.invalid',
        CI_POLICY_TOKEN: 'fixture',
        GITHUB_REPOSITORY_ID: '2',
        GITHUB_SHA: checkout,
      },
    }
  }
  const check = ({ payload, env }) => verifyForkInitialization(root, repository, payload, env)
  const clean = commitPr('node --test')
  await check(clean)
  const trusted = join(root, '.git', 'trusted')
  mkdirSync(trusted)
  execFileSync('git', ['init', '-q', trusted])
  const trustedGit = (...args) => execFileSync('git', ['-C', trusted, ...args])
  trustedGit('config', `url.file://${root}.insteadOf`, `https://github.com/${repository}.git`)
  trustedGit('config', 'protocol.file.allow', 'always')
  git('update-ref', 'refs/pull/1/merge', clean.env.GITHUB_SHA)
  const bin = join(root, '.git')
  writeFileSync(
    join(bin, 'gh'),
    `#!${process.execPath}
const { readFileSync } = require('node:fs');
const reply = JSON.parse(readFileSync(process.env.FORK_FIXTURES))[process.argv.at(-1).slice(6)];
if (!reply) process.exit(1);
console.log(JSON.stringify(reply));
`,
    { mode: 0o755 }
  )
  const fixturePath = join(bin, 'fork-fixtures.json')
  const verifyCommand = (pr) => {
    const forkPr = { ...pr, state: 'open', draft: false }
    writeFileSync(fixturePath, JSON.stringify({ ...responses, [`${repository}/pulls/1`]: forkPr }))
    return spawnSync(
      process.execPath,
      [join(import.meta.dirname, '../verify-first-product-pr.mjs'), repository, '1'],
      {
        cwd: trusted,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FORK_FIXTURES: fixturePath },
      }
    )
  }
  assert.match(verifyCommand(clean.payload.pull_request).stdout, /Verified fork initialization/)
  const changedVerifier = commitPr('node --test')
  put('scripts/verify-first-product-pr.mjs', '// substitute the gate')
  git('add', '.')
  const changedTree = git('write-tree')
  const changedHead = git('commit-tree', changedTree, '-p', base, '-m', 'substitute verifier')
  const changedMerge = git('commit-tree', changedTree, '-p', base, '-p', changedHead, '-m', 'merge')
  git('update-ref', 'refs/pull/1/merge', changedMerge)
  changedVerifier.payload.pull_request.head.sha = changedHead
  const substituted = verifyCommand(changedVerifier.payload.pull_request)
  assert.equal(substituted.status, 1)
  assert.match(substituted.stderr, /Outside supported product initialization/)
  delete responses[`${repository}/git/ref/heads/main`]
  const unavailable = verifyCommand(changedVerifier.payload.pull_request)
  assert.equal(unavailable.status, 1)
  assert.doesNotMatch(unavailable.stdout, /Verified fork initialization/)
  responses[`${repository}/git/ref/heads/main`] = { object: { sha: base } }
  git('restore', '--staged', '--worktree', 'scripts/verify-first-product-pr.mjs')
  git('checkout', '-q', clean.env.GITHUB_SHA)
  clean.payload.pull_request.head.repo.id = 3
  await assert.rejects(check(clean), /trusted fork metadata/)
  clean.payload.pull_request.head.repo.id = 2
  responses[`${canonical}/commits/v1.0.0`].sha = 'f'.repeat(40)
  await assert.rejects(check(clean), /published AMCore release/)
  responses[`${canonical}/commits/v1.0.0`].sha = base
  await assert.rejects(check(commitPr('echo bypass')), /Outside supported product initialization/)
  rmSync(join(root, 'scripts/verify-first-product-pr.mjs'))
  base = oldBase
  responses[`${canonical}/commits/v1.0.0`].sha = base
  responses[`${repository}/git/ref/heads/main`].object.sha = base
  await assert.rejects(check(commitPr('node --test')), /predates supported fork initialization/)
})
