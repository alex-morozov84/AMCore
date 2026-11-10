import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capacityDecision } from '../runner-disk/policy.mjs'
import { knownReadiness, probe, storageDecision } from '../runner-disk/probe.mjs'

const gib = 1024n ** 3n
const counters = {
  bytes: 100n * gib,
  freeBytes: 80n * gib,
  inodes: 20000000n,
  freeInodes: 16000000n,
}
const env = {
  RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_OS: 'Linux',
  RUNNER_ARCH: 'X64',
  GITHUB_WORKSPACE: '/workspace',
  RUNNER_TEMP: '/tmp',
}
const release = () => 'ID=ubuntu\nVERSION_ID="24.04"\n'

test('capacity uses exact integer byte and both inode boundaries', () => {
  const decide = (change) => capacityDecision({ ...counters, ...change }).skip
  assert.equal(decide({}), true)
  assert.equal(decide({ freeBytes: 80n * gib - 1n }), false)
  assert.equal(decide({ bytes: 500n * gib, freeBytes: 90n * gib }), true)
  assert.equal(decide({ bytes: 500n * gib, freeBytes: 90n * gib - 1n }), false)
  assert.equal(decide({ freeInodes: 15999999n }), false)
  assert.equal(decide({ inodes: 2500000n, freeInodes: 2125000n }), true)
  assert.equal(decide({ inodes: 2500000n, freeInodes: 2124999n }), false)
  for (const key of Object.keys(counters)) {
    for (const bad of [0n, -1n, undefined, '80', NaN]) assert.equal(decide({ [key]: bad }), false)
  }
  assert.equal(decide({ freeBytes: counters.bytes + 1n }), false)
  assert.equal(decide({ freeInodes: counters.inodes + 1n }), false)
})

test('only admitted lanes, runner and actual readiness source may reach storage probe', () => {
  assert.equal(knownReadiness(), true)
  let calls = 0
  const io = {
    release,
    readiness: () => true,
    storage: () => {
      calls++
      return { skip: true }
    },
  }
  for (const lane of ['path-standard', 'path-disruptive'])
    assert.equal(probe(lane, env, io).skip, true)
  for (const lane of [
    '',
    'safety',
    'mocked',
    'host',
    'docker-image-smoke',
    'observability-contract-live',
  ])
    assert.equal(probe(lane, env, io).skip, false)
  for (const change of [
    { RUNNER_ENVIRONMENT: 'self-hosted' },
    { RUNNER_OS: 'macOS' },
    { RUNNER_ARCH: 'ARM64' },
    { DOCKER_HOST: 'ssh://remote' },
    { DOCKER_CONTEXT: 'other' },
    { DOCKER_TLS_VERIFY: '' },
    { HEALTH_DISK_THRESHOLD_PERCENT: '0.9' },
  ])
    assert.equal(probe('path-standard', { ...env, ...change }, io).skip, false)
  assert.equal(
    probe('path-standard', env, { ...io, release: () => 'ID=ubuntu\nVERSION_ID="26.04"' }).skip,
    false
  )
  assert.equal(probe('path-standard', env, { ...io, readiness: () => false }).skip, false)
  assert.equal(calls, 2)
})

test('storage admission requires default local socket and one filesystem including application root', () => {
  const context = [{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }]
  const info = { OSType: 'linux', Driver: 'overlay2', DockerRootDir: '/var/lib/docker' }
  const io = {
    docker: (args) => JSON.stringify(args[0] === 'context' ? context : info),
    realpath: (path) => path,
    stat: () => ({ dev: 1n }),
    statfs: () => ({
      blocks: counters.bytes,
      bsize: 1n,
      bavail: counters.freeBytes,
      files: counters.inodes,
      ffree: counters.freeInodes,
    }),
  }
  const decide = (changes) => storageDecision(env, { ...io, ...changes })
  assert.equal(decide({}).skip, true)
  assert.equal(decide({ stat: (path) => ({ dev: path === '/' ? 2n : 1n }) }).skip, false)
  assert.equal(
    decide({ docker: () => JSON.stringify([{ Endpoints: { docker: { Host: 'tcp://remote' } } }]) })
      .skip,
    false
  )
  assert.equal(
    decide({
      docker: (args) =>
        JSON.stringify(args[0] === 'context' ? context : { ...info, Driver: 'overlayfs' }),
    }).skip,
    false
  )
  assert.equal(storageDecision({ ...env, RUNNER_TEMP: '' }, io).skip, false)
  assert.throws(() => decide({ docker: () => '{broken' }))
  assert.throws(() =>
    decide({
      stat: () => {
        throw new Error('permission')
      },
    })
  )
})
