import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostedLinux, reserve, sufficient, removable, monitor } from '../ci-disk.mjs'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test(
  'reserve breach terminates the owned command and a late exit0 cannot turn it green',
  { timeout: 10_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ci-disk-command-'))
    const state = join(directory, 'state.json')
    const original = process.exitCode
    try {
      await monitor(
        [
          process.execPath,
          '-e',
          `
      const fs=require('node:fs'),state=process.argv[1];
      process.on('SIGTERM',()=>{fs.writeFileSync(state,JSON.stringify({pid:process.pid,stopped:true}));process.exit(0)});
      fs.writeFileSync(state,JSON.stringify({pid:process.pid,stopped:false}));setInterval(()=>{},1000);
    `,
          state,
        ],
        [],
        (phase) => phase === 'before-command' || (phase === 'running' && !existsSync(state))
      )
      assert.equal(process.exitCode, 1)
      const child = JSON.parse(readFileSync(state, 'utf8'))
      assert.equal(child.stopped, true)
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
    } finally {
      process.exitCode = original
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

test('disk monitor preserves command failure even when final measurement fails', async () => {
  const original = process.exitCode
  try {
    await monitor([process.execPath, '-e', 'process.exit(7)'], [], (phase) => {
      if (phase === 'after-command') throw new Error('synthetic measurement failure')
      return true
    })
    assert.equal(process.exitCode, 7)
    await assert.rejects(
      monitor([process.execPath, '-e', 'process.exit(0)'], [], () => false),
      /reserve/
    )
  } finally {
    process.exitCode = original
  }
})

test('disk cleanup refuses local/self-hosted/foreign platform and non-allowlisted paths', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', CI_RUNNER_ENVIRONMENT: 'github-hosted' }
  assert.equal(hostedLinux(env, 'linux'), true)
  assert.equal(hostedLinux(env, 'darwin'), false)
  for (const key of Object.keys(env))
    assert.equal(hostedLinux({ ...env, [key]: '' }, 'linux'), false)
  assert.equal(hostedLinux({ ...env, CI_RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux'), false)
  const stat = { isDirectory: () => true, isSymbolicLink: () => false, uid: 0, dev: 1 }
  const path = '/usr/share/dotnet'
  const check = (entry = stat, mounts = '', real = (p) => p) =>
    removable(path, mounts, () => entry, real)
  assert.equal(check(), true)
  assert.equal(
    removable(
      '/opt/hostedtoolcache',
      '',
      () => stat,
      (p) => p
    ),
    false
  )
  assert.equal(check({ ...stat, uid: 501 }), false)
  assert.equal(check({ ...stat, isSymbolicLink: () => true }), false)
  assert.equal(check({ ...stat, isDirectory: () => false }), false)
  assert.equal(
    check(stat, '', () => '/foreign'),
    false
  )
  assert.equal(check(stat, '1 0 0:1 / /usr/share/dotnet/foreign rw'), false)
  assert.equal(
    removable(
      path,
      '',
      (p) => ({ ...stat, dev: p === path ? 2 : 1 }),
      (p) => p
    ),
    false
  )
})

test('reserve refuses bytes OR inode exhaustion and admits the exact experiment floor', () => {
  const floor = { bsize: 4096, bavail: 524288, ffree: 5, files: 100 }
  assert.equal(sufficient(reserve(floor)), true)
  assert.equal(sufficient(reserve({ ...floor, bavail: floor.bavail - 1 })), false)
  assert.equal(sufficient(reserve({ ...floor, ffree: 4 })), false)
  assert.equal(sufficient(reserve({ ...floor, files: 0 })), false)
})
