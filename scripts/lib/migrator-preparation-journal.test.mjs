import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { save, load, recover } from '../migrator-preparation/resources.mjs'

function fixture(t) {
  const output = fs.mkdtempSync(join(tmpdir(), 'migrator-preparation-journal-'))
  const f = {
    version: 1,
    output,
    run: randomUUID(),
    endpoint: 'unix:///fixture',
    builders: [],
    images: [],
    containers: [],
    volumes: [],
    clients: [],
  }
  const path = join(output, 'resources.json'),
    temporary = `${path}.tmp`
  t.mock.method(childProcess, 'execFileSync', () =>
    assert.fail('Journal tests must not call Docker')
  )
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    fs.rmSync(output, { recursive: true, force: true })
  })
  save(f)
  return { f, path, temporary, previous: fs.readFileSync(path, 'utf8') }
}

for (const operation of ['write', 'rename']) {
  test(`failed ${operation} retains the readable committed journal and primary error`, async (t) => {
    const { f, path, temporary, previous } = fixture(t)
    const primary = Object.assign(new Error('fixture journal I/O failure'), { code: 'ENOSPC' })
    const originalWrite = fs.writeFileSync
    const method = operation === 'write' ? 'writeFileSync' : 'renameSync'
    const injected = t.mock.method(fs, method, (destination) => {
      assert.equal(fs.readFileSync(path, 'utf8'), previous)
      if (operation === 'write') originalWrite(destination, '{"partial":', { mode: 0o600 })
      throw primary
    })
    syncBuiltinESMExports()
    f.images.push(`amcore-migrator-prep-${f.run}-not-created`)
    assert.throws(
      () => save(f),
      (error) => error === primary
    )
    assert.equal(fs.readFileSync(path, 'utf8'), previous)
    assert.deepEqual(load(f.output).images, []) // Never promote even a complete uncommitted temp file.
    assert.equal(fs.statSync(path).mode & 0o777, 0o600)
    assert.equal(fs.statSync(temporary).mode & 0o777, 0o600)
    injected.mock.restore()
    syncBuiltinESMExports()
    await recover(f.output) // No resources were created; no Docker operation is needed.
    assert.equal(fs.existsSync(path), false)
    assert.equal(fs.existsSync(temporary), false)
    assert.equal(JSON.parse(fs.readFileSync(join(f.output, 'cleanup.json'))).complete, true)
  })
}

test('a later successful save replaces a partial temp file with private permissions', (t) => {
  const { f, path, temporary } = fixture(t)
  fs.writeFileSync(temporary, '{"partial":', { mode: 0o600 })
  f.images.push(`amcore-migrator-prep-${f.run}-not-created`)
  save(f)
  assert.deepEqual(load(f.output), f)
  assert.equal(fs.statSync(path).mode & 0o777, 0o600)
  assert.equal(fs.existsSync(temporary), false)
})

test('recovery refuses a lone uncommitted temp file and retains it for inspection', async (t) => {
  const { f, path, temporary } = fixture(t)
  fs.unlinkSync(path)
  fs.writeFileSync(temporary, '{"partial":', { mode: 0o600 })
  await assert.rejects(recover(f.output), /Uncommitted preparation journal/)
  assert.equal(fs.existsSync(temporary), true)
  assert.equal(fs.existsSync(join(f.output, 'cleanup.json')), false)
})

test('failed removal of the temp file keeps the committed journal recoverable', async (t) => {
  const { f, path, temporary, previous } = fixture(t)
  fs.writeFileSync(temporary, '{"partial":', { mode: 0o600 })
  const primary = Object.assign(new Error('fixture temp removal failure'), { code: 'EPERM' })
  const originalRemove = fs.rmSync
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === temporary) throw primary
    return originalRemove(target, options)
  })
  syncBuiltinESMExports()
  await assert.rejects(recover(f.output), (error) => error === primary)
  assert.equal(fs.readFileSync(path, 'utf8'), previous)
  assert.deepEqual(load(f.output), f)
  assert.equal(fs.existsSync(join(f.output, 'cleanup.json')), false)
})
