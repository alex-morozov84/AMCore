import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  put('package.json', '{"name":"amcore","description":"starter","scripts":{"test":"node --test"}}')
  git('add', '.')
  git('commit', '-qm', 'starter')
  const base = git('rev-parse', 'HEAD')
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
  clean.payload.pull_request.head.repo.id = 3
  await assert.rejects(check(clean), /trusted fork metadata/)
  clean.payload.pull_request.head.repo.id = 2
  responses[`${canonical}/commits/v1.0.0`].sha = 'f'.repeat(40)
  await assert.rejects(check(clean), /published AMCore release/)
  responses[`${canonical}/commits/v1.0.0`].sha = base
  await assert.rejects(check(commitPr('echo bypass')), /Outside supported product initialization/)
})
