import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { command } from '../api-e2e/measurement-command.mjs'

test('M1 TERM-ignoring direct child is killed at deadline and retains error', () => {
  const directory = mkdtempSync(join(tmpdir(), 't041-telemetry-'))
  const state = join(directory, 'child.json')
  let pid
  try {
    const script = `const fs=require('node:fs');process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(state)},JSON.stringify({pid:process.pid,ignoredTerm:true})));process.kill(process.pid,'SIGTERM');setInterval(()=>{},10)`
    const began = performance.now()
    const result = command(process.execPath, ['-e', script], 200)
    const child = JSON.parse(readFileSync(state, 'utf8'))
    pid = child.pid
    assert.equal(child.ignoredTerm, true)
    assert.ok(performance.now() - began < 1000)
    assert.equal(result.value, null)
    assert.ok(result.error)
    assert.equal(result.code, 'ETIMEDOUT')
    assert.equal(result.signal, 'SIGKILL')
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    try {
      pid ??= JSON.parse(readFileSync(state, 'utf8')).pid
      process.kill(pid, 'SIGKILL')
    } catch {
      /* Already closed or never started. */
    }
    rmSync(directory, { recursive: true, force: true })
  }
})

test('M1 successful command returns its value', () => {
  assert.deepEqual(command(process.execPath, ['-e', "console.log('ready')"]), { value: 'ready' })
})

test('M1 absent command preserves diagnostic without invented value', () => {
  const result = command('/nonexistent/t041-telemetry-command', [])
  assert.equal(result.value, null)
  assert.ok(result.error)
  assert.equal(result.code, 'ENOENT')
})
