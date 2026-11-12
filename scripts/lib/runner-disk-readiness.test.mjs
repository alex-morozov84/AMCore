import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const gib = 1024n ** 3n
const eligible = [
  'path-standard',
  'path-disruptive',
  'staff-path-oauth',
  'staff-oauth',
  'staff-console-path',
  'staff-host',
  'host',
  'setup-cli',
  'setup-console',
  'staff-invitation',
  'support-mail-path',
  'support-mail-host',
]
const updates = [
  'pnpm-lock.yaml',
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
  'apps/api/Dockerfile',
]

function dependencyInput(path, patch) {
  if (path.endsWith('Dockerfile')) return `FROM node:24@sha256:${String(patch).repeat(64)}\n`
  if (path.endsWith('.yaml'))
    return `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.${patch}: {}\n`
  return JSON.stringify({ name: 'fixture', dependencies: { 'fixture-dependency': `1.0.${patch}` } })
}

function prepareFixture(directory) {
  const moduleRoot = join(directory, 'scripts/runner-disk')
  mkdirSync(moduleRoot, { recursive: true })
  for (const name of ['probe.mjs', 'policy.mjs'])
    writeFileSync(join(moduleRoot, name), readFileSync(`scripts/runner-disk/${name}`))
  for (const path of updates) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), dependencyInput(path, 0))
  }
  return pathToFileURL(join(moduleRoot, 'probe.mjs')).href
}

const storageIO = {
  docker: (args) =>
    JSON.stringify(
      args[0] === 'context'
        ? [{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }]
        : { OSType: 'linux', Driver: 'overlay2', DockerRootDir: '/docker' }
    ),
  realpath: (path) => path,
  stat: () => ({ dev: 1n }),
  statfs: () => ({
    blocks: 100n * gib,
    bsize: 1n,
    bavail: 80n * gib,
    files: 20000000n,
    ffree: 16000000n,
  }),
}

test('compatible dependency inputs retain admission while unsafe capacity and contracts refuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-readiness-'))
  try {
    const { probe, storageDecision } = await import(prepareFixture(directory))
    const env = {
      RUNNER_ENVIRONMENT: 'github-hosted',
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
      GITHUB_WORKSPACE: directory,
      RUNNER_TEMP: directory,
    }
    const io = {
      release: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
      storage: (environment) => storageDecision(environment, storageIO),
    }
    for (const path of updates) {
      assert.equal(probe('path-standard', env, io).skip, true, `before ${path}`)
      writeFileSync(join(directory, path), dependencyInput(path, 1))
      for (const lane of eligible)
        assert.equal(probe(lane, env, io).skip, true, `after ${path}: ${lane}`)
    }
    const low = {
      ...io,
      storage: (environment) =>
        storageDecision(environment, {
          ...storageIO,
          statfs: () => ({ ...storageIO.statfs(), bavail: 79n * gib }),
        }),
    }
    for (const lane of eligible) assert.equal(probe(lane, env, low).skip, false)
    for (const contract of [
      null,
      {},
      { path: '/other', threshold: '0.9' },
      { path: '/', threshold: '0.75' },
    ]) {
      for (const lane of eligible)
        assert.deepEqual(
          probe(
            lane,
            env,
            {
              ...io,
              storage: () => assert.fail('unsupported readiness must not probe storage'),
            },
            contract
          ),
          { skip: false, reason: 'unsupported-readiness' }
        )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
