import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observeTree, observeGroup, assertGroupsAbsent } from './process-groups.mjs'
import { assertSupervisorAbsent } from './process-identity.mjs'
const parent = { pid: 100, parent: 1, pgid: 100, started: 'parent-birth' }
const original = { pid: 200, parent: 100, pgid: 200, started: 'owned-birth' }
const foreign = { pid: 200, parent: 1, pgid: 200, started: 'foreign-birth' }
const tracked = () => ({ pid: 100, standMembers: [{ pid: 100, started: parent.started }] })

test('generation retirement: complete absence retires a group while parent stays live', () => {
  const child = tracked()
  observeTree(child, [parent, original])
  const group = child.standDetached[0]
  observeTree(child, [parent])
  assert.equal(child.standDetached.length, 0)
  assert.equal(observeTree(child, [parent, foreign]), true)
  assert.equal(observeGroup(group, [foreign]), false, 'retired identity never signals new owner')
})
test('generation retirement: active tracking stays bounded under ten thousand groups', () => {
  const child = tracked()
  for (let n = 0; n < 10000; n++) {
    const pid = 1000 + n
    observeTree(child, [parent, { pid, parent: 100, pgid: pid, started: `birth-${n}` }])
    assert.equal(child.standDetached.length, 1)
    observeTree(child, [parent])
    assert.equal(child.standDetached.length, 0)
  }
})
test('generation retirement: reuse without observed absence remains unproved', () => {
  const child = tracked()
  observeTree(child, [parent, original])
  assert.throws(() => observeTree(child, [parent, foreign]), /unproved or reused/)
})
test('generation retirement: extinct leader cannot adopt foreign reuse while descendant lives', () => {
  const child = tracked()
  observeTree(child, [parent, original])
  observeTree(child, [original])
  assert.equal(child.standGroupAbsent, true)
  assert.equal(observeTree(child, [{ ...parent, started: 'foreign-parent' }, original]), true)
  assert.equal(child.standDetached.length, 1)
})
test('generation recovery: old journal distinguishes foreign reuse but refuses ambiguity and survivors', () => {
  const old = {
    pid: 200,
    started: original.started,
    members: [{ pid: 200, started: original.started }],
  }
  assertGroupsAbsent([old], [foreign])
  assertGroupsAbsent([old], [{ ...foreign, pgid: 300 }])
  assert.throws(() => assertGroupsAbsent([old], [original]), /group alive/)
  assert.throws(() => assertGroupsAbsent([old], [{ ...original, pgid: 300 }]), /group alive/)
  assert.throws(
    () => assertGroupsAbsent([{ ...old, members: [] }], [foreign]),
    /without birth proof/
  )
  assert.throws(() => assertGroupsAbsent([old], [{ ...foreign, pid: 201 }]), /without birth proof/)
})
test('generation recovery: supervisor birth reuse accepted, live or legacy ambiguity refused', () => {
  assertSupervisorAbsent({ pid: 200, birth: original.started }, [foreign])
  assert.throws(
    () => assertSupervisorAbsent({ pid: 200, birth: original.started }, [original]),
    /supervisor alive/
  )
  assert.throws(
    () => assertSupervisorAbsent({ pid: 200, started: new Date().toISOString() }, [foreign]),
    /without birth proof/
  )
})
