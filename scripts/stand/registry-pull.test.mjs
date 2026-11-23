import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isTransientPullFailure, pullMigratorBase, pullWithRetry } from './registry-pull.mjs'

const registry502 = new Error('docker failed (1): received unexpected HTTP status: 502 Bad Gateway')
const noWait = async () => undefined

test('a cold stand retries pulling the exact migrator image after a manifest timeout', async () => {
  const dockerfile = readFileSync(new URL('../../apps/api/Dockerfile', import.meta.url), 'utf8')
  const calls = []
  await pullMigratorBase(
    dockerfile,
    async (args) => {
      calls.push(args)
      if (calls.length === 1) throw new Error('No such image')
      if (calls.length === 2) throw new Error('failed to resolve source metadata: i/o timeout')
    },
    { wait: noWait }
  )
  const image = calls[0][2]
  assert.match(image, /^ghcr\.io\/pnpm\/pnpm:[^@]+@sha256:[a-f0-9]{64}$/)
  assert.ok(dockerfile.includes(`FROM ${image} AS migrator-pnpm`))
  assert.deepEqual(calls, [
    ['image', 'inspect', image],
    ['pull', '--quiet', image],
    ['pull', '--quiet', image],
  ])
})

test('a registry 502 is retried until the pull succeeds', async () => {
  let calls = 0
  await pullWithRetry(
    async () => {
      if (++calls < 3) throw registry502
    },
    { wait: noWait }
  )
  assert.equal(calls, 3)
})

test('the last transient failure is thrown after the attempts are used', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      pullWithRetry(
        async () => {
          calls++
          throw registry502
        },
        { attempts: 2, wait: noWait }
      ),
    registry502
  )
  assert.equal(calls, 2)
})

test('interruption and permanent failures are never retried', async () => {
  for (const message of [
    'docker failed (130): received unexpected HTTP status: 502',
    'docker failed (SIGTERM): timeout',
    'docker failed (1): pull access denied for redis, repository does not exist',
    'docker failed (1): no space left on device',
  ]) {
    assert.equal(isTransientPullFailure(new Error(message)), false, message)
    let calls = 0
    await assert.rejects(
      () =>
        pullWithRetry(
          async () => {
            calls++
            throw new Error(message)
          },
          { wait: noWait }
        ),
      { message }
    )
    assert.equal(calls, 1, message)
  }
})
