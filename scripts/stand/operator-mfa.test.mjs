import assert from 'node:assert/strict'
import { test } from 'node:test'

import { operatorMfaEnvironment, operatorMfaWanted, prepareOperatorMfa } from './operator-mfa.mjs'

const base = {
  purpose: 'preview',
  mocked: false,
  consoleEnabled: true,
  consoleTopology: 'path',
  fixtureProfile: 'default',
}

test('operator MFA is wanted only for a Docker preview with a path-mode Console and an operator', () => {
  assert.equal(operatorMfaWanted(base), true)
  assert.equal(operatorMfaWanted({ ...base, fixtureProfile: 'scheduled-jobs' }), true)
  for (const change of [
    { purpose: 'e2e' },
    { mocked: true },
    { consoleEnabled: false },
    { consoleTopology: 'host' },
    { fixtureProfile: 'account-mfa-ui' },
    { fixtureProfile: 'user' },
  ])
    assert.equal(operatorMfaWanted({ ...base, ...change }), false, JSON.stringify(change))
})

test('the environment carries a key only for stands that opted in, and the key is per stand', () => {
  assert.deepEqual(operatorMfaEnvironment({ operatorMfa: false, jwtSecret: 'x'.repeat(64) }), {})
  const a = operatorMfaEnvironment({ operatorMfa: true, jwtSecret: 'a'.repeat(64) })
  const b = operatorMfaEnvironment({ operatorMfa: true, jwtSecret: 'b'.repeat(64) })
  assert.equal(a.MFA_ACTIVE_KEY_ID, 'managed-preview')
  assert.notEqual(a.MFA_ENCRYPTION_KEYS, b.MFA_ENCRYPTION_KEYS)
  assert.equal(
    Buffer.from(Object.values(JSON.parse(a.MFA_ENCRYPTION_KEYS))[0], 'base64').length,
    32
  )
  assert.throws(
    () => operatorMfaEnvironment({ operatorMfa: true, jwtSecret: 'short' }),
    /owned stand secret/
  )
})

test('the protocol is seeded only for opted-in stands and an unexpected result is refused', async () => {
  const calls = []
  const run = async (_m, statement) => (calls.push(statement), 'active:1\n')
  await prepareOperatorMfa({ operatorMfa: false }, run)
  assert.equal(calls.length, 0)
  await prepareOperatorMfa({ operatorMfa: true }, run)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /core\.mfa_protocol/)
  await assert.rejects(
    prepareOperatorMfa({ operatorMfa: true }, async () => 'prepared:2\n'),
    /Unsupported operator MFA protocol/
  )
})
