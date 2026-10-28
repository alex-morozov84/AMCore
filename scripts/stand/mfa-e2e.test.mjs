import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixtureInput } from './local-sql.mjs'
import { mfaE2EEnvironment, prepareMfaE2E } from './mfa-e2e.mjs'

const fixture = () => ({
  uuid: '01900000-0000-7000-8000-000000000001',
  purpose: 'e2e',
  mocked: false,
  jwtSecret: 'a'.repeat(64),
  runToken: 'owned-invocation',
  snapshot: '/owned/snapshot',
  worktree: '/owned/task',
})

test('only Docker E2E gets isolated deterministic keys, never ambient keys', () => {
  assert.deepEqual(mfaE2EEnvironment({ ...fixture(), purpose: 'preview' }), {})
  assert.deepEqual(mfaE2EEnvironment({ ...fixture(), mocked: true }), {})
  const first = mfaE2EEnvironment(fixture())
  assert.deepEqual(first, mfaE2EEnvironment(fixture()))
  assert.notDeepEqual(first, mfaE2EEnvironment({ ...fixture(), jwtSecret: 'b'.repeat(64) }))
  assert.equal(
    Buffer.from(JSON.parse(first.MFA_ENCRYPTION_KEYS)['managed-e2e'], 'base64').length,
    32
  )
})

test('protocol fixture requires Docker purpose, snapshot and admitted invocation', async () => {
  for (const override of [
    { purpose: 'preview' },
    { mocked: true },
    { runToken: null },
    { snapshot: '/owned/task' },
  ]) {
    let calls = 0
    await assert.rejects(
      prepareMfaE2E({ ...fixture(), ...override }, async () => {
        calls++
        return 'active:1'
      })
    )
    assert.equal(calls, 0)
  }
})

test('only a supported protocol is seeded through the provided owned SQL boundary', async () => {
  let calls = 0
  await prepareMfaE2E(fixture(), async (m, sql) => {
    calls++
    assert.equal(m.runToken, 'owned-invocation')
    assert.match(sql, /version = 1/)
    assert.match(fixtureInput(m, sql), /stand_meta.identity/)
    assert.doesNotMatch(sql, /mfa_accounts|mfa_factors|sessions/)
    return 'active:1\nINSERT 0 1\n'
  })
  assert.equal(calls, 1)
  await assert.rejects(
    prepareMfaE2E(fixture(), async () => 'INSERT 0 0\n'),
    /Unsupported/
  )
})
