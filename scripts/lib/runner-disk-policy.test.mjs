import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capacityDecision } from '../runner-disk/policy.mjs'
import { probe, storageDecision } from '../runner-disk/probe.mjs'

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
  for (const contract of [
    null,
    {},
    { path: '/', threshold: '0.75' },
    { path: '/other', threshold: '0.9' },
  ])
    assert.equal(capacityDecision(counters, contract).skip, false)
})

test('only admitted lanes, runner and admitted readiness may reach storage probe', () => {
  let calls = 0
  const io = {
    release,
    storage: () => {
      calls++
      return { skip: true }
    },
  }
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
  for (const lane of eligible) assert.equal(probe(lane, env, io).skip, true)
  for (const lane of [
    '',
    'safety',
    'mocked',
    'organization-provisioning',
    'organization-shop',
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
    { DOCKER_CONFIG: '/other' },
    { DOCKER_TLS_VERIFY: '' },
    { HEALTH_DISK_THRESHOLD_PERCENT: '0.9' },
  ])
    for (const lane of eligible) assert.equal(probe(lane, { ...env, ...change }, io).skip, false)
  assert.equal(
    probe('path-standard', env, { ...io, release: () => 'ID=ubuntu\nVERSION_ID="26.04"' }).skip,
    false
  )
  assert.equal(probe('path-standard', env, io, { path: '/other', threshold: '0.9' }).skip, false)
  assert.equal(calls, eligible.length)
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
