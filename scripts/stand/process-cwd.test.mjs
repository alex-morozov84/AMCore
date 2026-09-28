import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linuxCwds, sourceSurvivors } from './process-cwd.mjs'
import { assertGroupsAbsent } from './process-groups.mjs'

const roots = ['/tmp/stand/source', '/tmp/stand/record']
const row = (pid, command = 'unrelated-worker') => ({
  pid,
  pgid: pid,
  uid: process.getuid(),
  started: 'known birth',
  command,
})
const denied = (code) => Object.assign(new Error('cwd unavailable'), { code })

for (const code of ['EACCES', 'EPERM']) {
  test(`Linux cwd inventory tolerates unrelated ${code} but still reads other rows`, () => {
    const readlink = (path) => {
      if (path === '/proc/1221/cwd') throw denied(code)
      return roots[0]
    }
    const paths = linuxCwds([row(1221), row(1222)], roots, new Set(), readlink)
    assert.equal(paths.has(1221), false)
    assert.equal(paths.get(1222), roots[0])
  })

  test(`Linux cwd ${code} for a stand command still refuses removal`, () => {
    for (const root of roots)
      assert.throws(
        () =>
          linuxCwds([row(1221, `node ${root}/worker`)], roots, new Set(), () => {
            throw denied(code)
          }),
        { code }
      )
  })
}

test('Linux cwd inventory never reads excluded ancestors or different-user rows', () => {
  assert.equal(
    linuxCwds(
      [row(1221), { ...row(1222), uid: process.getuid() + 1 }],
      roots,
      new Set([1221]),
      () => {
        assert.fail('excluded cwd was read')
      }
    ).size,
    0
  )
})

test('Linux cwd inventory tolerates process exit races but propagates other IO failures', () => {
  for (const code of ['ENOENT', 'ESRCH'])
    assert.equal(
      linuxCwds([row(1221)], roots, new Set(), () => {
        throw denied(code)
      }).size,
      0
    )
  assert.throws(
    () =>
      linuxCwds([row(1221)], roots, new Set(), () => {
        throw denied('EIO')
      }),
    { code: 'EIO' }
  )
})

test('Unreadable cwd cannot bypass independent recorded child/group identity checks', () => {
  const live = row(1221)
  assert.equal(
    linuxCwds([live], roots, new Set(), () => {
      throw denied('EACCES')
    }).size,
    0
  )
  assert.throws(
    () => assertGroupsAbsent([{ pid: live.pid, started: live.started }], [live]),
    /recovery\/removal refused/
  )
})

test('native cwd discovery still detects a readable source-root process', () => {
  const m = { snapshot: process.cwd(), worktree: '/tmp/unused', id: 'cwd-proof' }
  assert.equal(sourceSurvivors(m, [row(process.pid)], new Set())[0]?.pid, process.pid)
})
