import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = new URL('../../', import.meta.url)

test('policy applies to the shared npm update root and keeps retry privileges on trusted main', async () => {
  const bot = parse(await readFile(new URL('.github/dependabot.yml', root), 'utf8'))
  assert.deepEqual(
    bot.updates
      .filter((entry) => entry['package-ecosystem'] === 'npm')
      .map((entry) => [entry.directory, entry.cooldown['default-days']]),
    [['/', 3]]
  )
  const workflow = parse(
    await readFile(new URL('.github/workflows/dependabot-retry.yml', root), 'utf8')
  )
  assert.deepEqual(workflow.permissions, {})
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs.retry.if, "github.ref == 'refs/heads/main'")
  assert.deepEqual(workflow.jobs.retry.permissions, {
    contents: 'read',
    'pull-requests': 'read',
    actions: 'write',
  })
  assert.equal(workflow.jobs.retry.steps[0].with.ref, 'main')
  assert.equal(workflow.jobs.retry.steps[0].with['persist-credentials'], false)
})

function pnpm(directory, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: directory,
      timeout: 20000,
      env: { ...process.env, CI: 'true' },
    })
    let text = ''
    child.stdout.on('data', (chunk) => {
      text += chunk
    })
    child.stderr.on('data', (chunk) => {
      text += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, text }))
  })
}

for (const [scenario, timestamp, error] of [
  ['newly published version', new Date().toISOString(), 'ERR_PNPM_NO_MATURE_MATCHING_VERSION'],
  ['unknown publication time', undefined, 'ERR_PNPM_MISSING_TIME'],
])
  test(`pinned pnpm rejects ${scenario} with root policy`, { timeout: 30000 }, async () => {
    const policy = parse(await readFile(new URL('pnpm-workspace.yaml', root), 'utf8'))
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    assert.equal(policy.minimumReleaseAge, 1440)
    assert.equal(policy.minimumReleaseAgeStrict, true)
    assert.equal(policy.minimumReleaseAgeIgnoreMissingTime, false)
    assert.equal(policy.trustLockfile, undefined)
    assert.equal(policy.minimumReleaseAgeExclude, undefined)
    const directory = await mkdtemp(join(tmpdir(), 'amcore-age-policy-'))
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          name: 'age-policy-fixture',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'age-policy-fixture',
              version: '1.0.0',
              dist: {
                tarball: `http://127.0.0.1:${server.address().port}/fixture.tgz`,
                shasum: '0'.repeat(40),
              },
            },
          },
          ...(timestamp ? { time: { '1.0.0': timestamp } } : {}),
        })
      )
    })
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          private: true,
          packageManager: manifest.packageManager,
          dependencies: { 'age-policy-fixture': '1.0.0' },
        })
      )
      await writeFile(
        join(directory, 'pnpm-workspace.yaml'),
        `packages: []\nminimumReleaseAge: ${policy.minimumReleaseAge}\nminimumReleaseAgeStrict: ${policy.minimumReleaseAgeStrict}\nminimumReleaseAgeIgnoreMissingTime: ${policy.minimumReleaseAgeIgnoreMissingTime}\n`
      )
      const version = await pnpm(directory, ['--version'])
      assert.equal(version.code, 0, version.text)
      assert.equal(version.text.trim(), manifest.packageManager.match(/^pnpm@(\d+\.\d+\.\d+)/)[1])
      const output = await pnpm(directory, [
        'install',
        '--lockfile-only',
        '--ignore-scripts',
        `--registry=http://127.0.0.1:${server.address().port}`,
        '--reporter=append-only',
      ])
      assert.notEqual(output.code, 0, output.text)
      assert.ok(output.text.includes(error), output.text)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  })
