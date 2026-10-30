import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resetBrowserProbeDomainBudget,
  resetMfaDomainSourceBudgets,
} from '../../apps/web/e2e/support/mfa-domain-fixture.mjs'

const owned = { purpose: 'e2e', mocked: false, runToken: 'admitted-token' }
test('domain reset refuses preview, mocks and absent invocation before Redis access', () => {
  for (const target of [
    { ...owned, purpose: 'preview' },
    { ...owned, mocked: true },
    { ...owned, runToken: null },
  ])
    assert.throws(
      () => resetMfaDomainSourceBudgets(target, () => assert.fail('Redis accessed')),
      /admitted disposable/
    )
})
test('domain reset removes only validated source limiter keys through the guarded executor', () => {
  const key = `rate:mfa_source:v1:start:${'a'.repeat(64)}`
  const calls = []
  resetMfaDomainSourceBudgets(owned, (...args) => {
    calls.push(args)
    return calls.length === 1 ? key : '1'
  })
  assert.deepEqual(calls[1], ['redis', 'redis-cli', 'UNLINK', key])
  assert.equal(calls.length, 2)
})
test('unexpected keys refuse mutation and an empty scan performs no mutation', () => {
  let calls = 0
  assert.throws(
    () =>
      resetMfaDomainSourceBudgets(owned, () => {
        calls++
        return 'web:session:foreign'
      }),
    /Unexpected/
  )
  assert.equal(calls, 1)
  resetMfaDomainSourceBudgets(owned, (...args) => {
    assert.ok(args.includes('--scan'))
    return ''
  })
})

test('probe reset targets only the known handler and refuses foreign or malformed sources', () => {
  const calls = []
  resetBrowserProbeDomainBudget(
    owned,
    (...args) => calls.push(args),
    () => '127.0.0.1\n::1'
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 5)
  assert.ok(calls[0].slice(3).every((key) => /^ratelimit:v1:[a-f0-9]{64}$/.test(key)))
  for (const target of [
    { ...owned, purpose: 'preview' },
    { ...owned, mocked: true },
    { ...owned, runToken: null },
  ])
    assert.throws(
      () =>
        resetBrowserProbeDomainBudget(
          target,
          () => assert.fail(),
          () => assert.fail()
        ),
      /admitted disposable/
    )
  assert.throws(
    () =>
      resetBrowserProbeDomainBudget(
        owned,
        () => assert.fail(),
        () => 'unexpected'
      ),
    /Unexpected/
  )
  resetBrowserProbeDomainBudget(
    owned,
    () => assert.fail(),
    () => ''
  )
})
