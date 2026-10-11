import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundedPhase, cleanupE2E } from '../../apps/api/test/e2e-cleanup.ts'
import { closeE2EWorkers } from '../../apps/api/test/e2e-workers.ts'
import { queuedTemplate, observeDirectEmails } from '../../apps/api/test/email-secrets.helpers.ts'
test('cleanup attempts remaining resources after rejection, timeout and late settlement', async () => {
  const order = []
  await assert.rejects(
    cleanupE2E([
      {
        name: 'worker',
        milliseconds: 10,
        run: () => {
          order.push('worker')
          return new Promise(() => {})
        },
      },
      {
        name: 'app',
        milliseconds: 10,
        run: () => {
          order.push('app')
          throw new Error('close failed')
        },
      },
      { name: 'redis', milliseconds: 10, run: () => order.push('redis') },
      { name: 'postgres', milliseconds: 10, run: () => order.push('postgres') },
    ]),
    AggregateError
  )
  assert.deepEqual(order, ['worker', 'app', 'redis', 'postgres'])
})
test('actual worker rejection/hang is reported; known missing binding is distinct from lookup failure', async () => {
  class UnknownElementException extends Error {}
  await closeE2EWorkers(
    () => {
      throw new UnknownElementException()
    },
    () => {},
    boundedPhase,
    10
  )
  await assert.rejects(
    closeE2EWorkers(
      () => {
        throw new Error('lookup failed')
      },
      () => {},
      boundedPhase,
      10
    ),
    /lookup failed/
  )
  const closed = []
  await assert.rejects(
    closeE2EWorkers(
      () => ['reject', 'hang', 'missing', 'ok'],
      (name) => {
        if (name === 'missing') throw new UnknownElementException()
        return {
          close: async () => {
            closed.push(name)
            if (name === 'reject') throw new Error('worker rejected')
            if (name === 'hang') await new Promise(() => {})
          },
        }
      },
      boundedPhase,
      10
    ),
    AggregateError
  )
  assert.deepEqual(closed, ['reject', 'hang', 'ok'])
})
test('managed email inspector reaches nested secrets and direct observer selects exact call', async () => {
  assert.equal(
    queuedTemplate({ protocolVersion: 1, payload: { template: 'password-reset' } }),
    'password-reset'
  )
  assert.throws(() => queuedTemplate({ template: 'welcome' }))
  const service = { async sendNow() {} }
  const observer = observeDirectEmails(service)
  try {
    await observer.operation('welcome', 'a@example.com', async () => {
      await service.sendNow('other', 'b@example.com', {})
      await service.sendNow('welcome', 'a@example.com', {})
    })
    await observer.reset()
  } finally {
    observer.restore()
  }
})
