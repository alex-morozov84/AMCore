import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const receipt = JSON.parse(readFileSync('scripts/runner-disk/known-readiness.json', 'utf8'))
const source = (path) => `reviewed fixture: ${path}\n`

function prepareFixture(directory) {
  const expected = receipt.map(({ path }) => {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, source(path))
    return { path, sha256: createHash('sha256').update(source(path)).digest('hex') }
  })
  const moduleRoot = join(directory, 'scripts/runner-disk')
  mkdirSync(moduleRoot, { recursive: true })
  for (const name of ['probe.mjs', 'policy.mjs'])
    writeFileSync(join(moduleRoot, name), readFileSync(`scripts/runner-disk/${name}`))
  writeFileSync(join(moduleRoot, 'known-readiness.json'), JSON.stringify(expected))
  return pathToFileURL(join(moduleRoot, 'probe.mjs')).href
}

test('reviewed inputs admit probing; each changed input retains cleanup without renewing admission', async () => {
  const paths = receipt.map(({ path }) => path)
  assert.ok(paths.includes('pnpm-lock.yaml'))
  assert.ok(paths.includes('apps/api/package.json'))
  const directory = mkdtempSync(join(tmpdir(), 'runner-readiness-'))
  try {
    // Load the production probe with an isolated reviewed receipt, not the evolving checkout.
    const { knownReadiness, probe } = await import(prepareFixture(directory))
    let calls = 0
    const io = {
      release: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
      readiness: knownReadiness,
      storage: () => {
        calls++
        return { skip: true }
      },
    }
    const env = { RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }
    for (const path of paths) {
      assert.equal(knownReadiness(), true, path)
      assert.equal(probe('path-standard', env, io).skip, true, path)
      const before = calls
      writeFileSync(join(directory, path), 'changed effective configuration')
      assert.equal(knownReadiness(), false, path)
      assert.deepEqual(
        probe('path-standard', env, io),
        {
          skip: false,
          reason: 'readiness-source-changed',
        },
        path
      )
      assert.equal(calls, before, 'changed inputs must not reach the storage probe')
      writeFileSync(join(directory, path), source(path))
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
