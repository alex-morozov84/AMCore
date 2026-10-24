import assert from 'node:assert/strict'
import test from 'node:test'

import { loginDiagnosticsFixture } from './login-diagnostics-fixture.mjs'
import { fixtureInput } from './local-sql.mjs'

function fixture() {
  const m = {
    uuid: '2e3bce07-f514-4339-a331-e946684102eb',
    consoleEnabled: true,
    purpose: 'preview',
    fixtureProfile: 'login-diagnostics',
    accounts: [
      { id: 'user', role: 'USER', password: 'public-demo' },
      { id: 'operator', role: 'SUPER_ADMIN', password: 'public-demo' },
    ],
  }
  const calls = []
  let persisted
  let rows = []
  const io = {
    save: async (value) => {
      calls.push('save')
      persisted = globalThis.structuredClone(value)
    },
    log: () => {},
    sql: async (_m, query) => {
      fixtureInput(_m, query)
      if (query.includes("'collisions'")) {
        calls.push('check')
        return '{"collisions":0,"sourceReady":true}'
      }
      if (query.includes('INSERT INTO')) {
        calls.push('insert')
        rows = globalThis.structuredClone(m.loginDiagnosticsFixture.targets)
        return '{"users":4,"links":6,"events":5}'
      }
      calls.push('read')
      return JSON.stringify(rows)
    },
  }
  return { m, io, calls, persisted: () => persisted, rows: () => rows }
}

test('records provenance before admitted writes and separates targets from login principals', async () => {
  const f = fixture()
  const accounts = globalThis.structuredClone(f.m.accounts)
  await loginDiagnosticsFixture(f.m, f.io)
  assert.deepEqual(f.calls, ['save', 'check', 'insert', 'save', 'read'])
  assert.deepEqual(f.m.accounts, accounts)
  const record = f.persisted().loginDiagnosticsFixture
  assert.equal(record.targets.length, 4)
  assert.equal(record.identities.length, 6)
  assert.equal(record.events.length, 5)
  assert.deepEqual(
    record.targets.map((r) => r.password),
    [true, false, true, false]
  )
  assert.equal(record.identities.filter((r) => r.userId === record.targets[2].id).length, 5)
  assert.equal(new Set(record.identities.map((r) => r.provider)).size, 4)
  assert.ok(!JSON.stringify(record).includes('passwordHash'))
  assert.ok(!record.targets.some((r) => accounts.some((a) => a.id === r.id)))
})

test('a completed repeat preserves edits and deletion without any target write', async () => {
  const f = fixture()
  await loginDiagnosticsFixture(f.m, f.io)
  f.rows()[0].name = 'Owner changed name'
  f.rows()[0].email = 'owner-edit@example.test'
  f.rows().splice(1, 1)
  f.m.loginDiagnosticsFixture.identities.pop()
  const edited = globalThis.structuredClone(f.m)
  const rows = globalThis.structuredClone(f.rows())
  f.calls.length = 0
  await loginDiagnosticsFixture(f.m, f.io)
  assert.deepEqual(f.calls, ['read'])
  assert.deepEqual(f.m, edited)
  assert.deepEqual(f.rows(), rows)
})

test('foreign identity collision refuses adoption and every fixture DML', async () => {
  const f = fixture()
  f.io.sql = async () => {
    f.calls.push('check')
    return '{"collisions":1,"sourceReady":true}'
  }
  await assert.rejects(loginDiagnosticsFixture(f.m, f.io), /adoption refused/)
  assert.deepEqual(f.calls, ['save', 'check'])
  assert.equal(f.persisted().loginDiagnosticsFixture.prepared, false)
  await assert.rejects(loginDiagnosticsFixture(f.m, f.io), /interrupted/)
  assert.deepEqual(f.calls, ['save', 'check'])
})

test('SQL failure retains pending provenance and never retries an uncertain fixture write', async () => {
  const f = fixture()
  const original = f.io.sql
  f.io.sql = async (m, query) => {
    if (query.includes('INSERT INTO')) throw new Error('SQL unavailable')
    return original(m, query)
  }
  await assert.rejects(loginDiagnosticsFixture(f.m, f.io), /SQL unavailable/)
  const restarted = f.persisted()
  f.calls.length = 0
  await assert.rejects(loginDiagnosticsFixture(restarted, f.io), /interrupted/)
  assert.deepEqual(f.calls, [])
})

test('lost completion save preserves committed rows and refuses reseeding after restart', async () => {
  const f = fixture()
  const save = f.io.save
  f.io.save = async (m) => {
    if (m.loginDiagnosticsFixture.prepared) throw new Error('Completion save failed')
    await save(m)
  }
  await assert.rejects(loginDiagnosticsFixture(f.m, f.io), /Completion save failed/)
  assert.equal(f.rows().length, 4)
  const restarted = f.persisted()
  f.calls.length = 0
  await assert.rejects(loginDiagnosticsFixture(restarted, f.io), /interrupted/)
  assert.deepEqual(f.calls, [])
})

test('refuses a changed principal, stand, profile or disabled Console', async () => {
  for (const change of [
    (m) => {
      m.consoleEnabled = false
    },
    (m) => {
      m.purpose = 'e2e'
    },
    (m) => {
      m.fixtureProfile = 'default'
    },
    (m) => {
      m.accounts = []
    },
  ]) {
    const f = fixture()
    change(f.m)
    await assert.rejects(loginDiagnosticsFixture(f.m, f.io))
    assert.deepEqual(f.calls, [])
  }
  const f = fixture()
  await loginDiagnosticsFixture(f.m, f.io)
  f.m.accounts[0].id = 'foreign'
  f.calls.length = 0
  await assert.rejects(loginDiagnosticsFixture(f.m, f.io), /provenance changed/)
  assert.deepEqual(f.calls, [])
})
