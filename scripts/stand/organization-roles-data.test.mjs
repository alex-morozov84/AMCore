import assert from 'node:assert/strict'
import test from 'node:test'

import { INVITATIONS, ORGANIZATIONS, ROLES } from './organization-roles-data.mjs'
import { ids, seedUnits } from './organization-roles-sql.mjs'
import { fixtureInput } from './local-sql.mjs'

const target = { uuid: '123e4567-e89b-42d3-a456-426614174000' }
const tag = 'a1b2c3d4'

test('dataset has the agreed size', () => {
  assert.equal(ORGANIZATIONS.length, 3)
  assert.equal(
    Object.values(ROLES).reduce((sum, list) => sum + list.length, 0),
    55
  )
  assert.equal(
    ORGANIZATIONS.reduce((sum, o) => sum + o.members, 0),
    220
  )
  assert.equal(INVITATIONS.length, 14)
})

test('every unit is accepted by the fixture SQL guard', () => {
  for (const [label, query] of seedUnits(tag)) {
    assert.doesNotThrow(() => fixtureInput(target, query), label)
  }
})

test('generated ids satisfy the organization context id pattern', () => {
  const id = ids(tag)
  const pattern = /^[A-Za-z0-9_-]{1,128}$/
  for (const value of [id.org(1), id.user(220), id.member(220), id.role(1, 39), id.invite(14)])
    assert.match(value, pattern)
})

test('role names are unique per organization and the sizes match', () => {
  for (const list of Object.values(ROLES)) {
    const names = list.map(([name]) => name.toLowerCase())
    assert.equal(new Set(names).size, names.length)
    for (const [name, description] of list) {
      assert.ok(name.length >= 2 && name.length <= 50, name)
      assert.ok(description === null || description.length <= 255, name)
    }
  }
  assert.equal(ROLES[1].length, 40)
  assert.equal(ROLES[2].length, 12)
  assert.equal(ROLES[3].length, 3)
})

test('invitations reference roles that exist and keep pending emails unique', () => {
  const pending = new Set()
  for (const invite of INVITATIONS) {
    for (const index of invite.roles) assert.ok(ROLES[invite.org][index], `role ${index}`)
    const key = `${invite.org}:${invite.n}`
    assert.ok(!pending.has(key))
    pending.add(key)
  }
})

test('the dataset carries the agreed special cases', () => {
  const rules = (org, name) => ROLES[org].find(([n]) => n === name)[2]
  assert.deepEqual(rules(1, 'Duplicate presets'), ['read:own', 'read:own'])
  assert.deepEqual(rules(1, 'Shared permission A'), ['shared'])
  assert.deepEqual(rules(1, 'Shared permission B'), ['shared'])
  assert.deepEqual(rules(1, 'Empty role'), [])
  assert.ok(rules(1, 'Team coordinator').includes('team:all'))
  assert.ok(rules(1, 'Compliance reviewer').some((r) => r.inverted === true))
  assert.ok(rules(2, 'Oversized sample').includes('oversized'))
  assert.ok(ROLES[1].some(([n]) => n === 'Preview self-held role'))
})
