import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientPullFailure, pullWithRetry } from './registry-pull.mjs'

const registry502 = new Error('docker failed (1): received unexpected HTTP status: 502 Bad Gateway')
const noWait = async () => undefined

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
