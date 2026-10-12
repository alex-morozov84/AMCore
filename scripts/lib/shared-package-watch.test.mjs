import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { copyShared } from './shared-package-fixture.mjs'

async function waitFor(predicate, detail) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(50)
  }
  throw new Error(`Shared watch did not settle: ${detail()}`)
}

function hasMarker(directory, marker, expected) {
  return ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts'].every((name) => {
    try {
      return readFileSync(join(directory, 'dist', name), 'utf8').includes(marker) === expected
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  })
}

function groupAbsent(pid) {
  try {
    process.kill(-pid, 0)
    return false
  } catch (error) {
    if (error.code === 'ESRCH') return true
    throw error
  }
}

test(
  'package dev updates and removes modules in both runtime/type formats',
  { timeout: 75_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shared-watch-'))
    let child
    let output = ''
    let stopped = false
    try {
      copyShared(directory)
      child = spawn('pnpm', ['run', 'dev'], {
        cwd: directory,
        detached: true,
        env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })
      child.stdout.on('data', (data) => {
        output += data
      })
      child.stderr.on('data', (data) => {
        output += data
      })
      await waitFor(
        () => output.includes('Rebuilt') && hasMarker(directory, 'registerSchema', true),
        () => output
      )
      const index = join(directory, 'src/index.ts')
      const original = readFileSync(index)
      const module = join(directory, 'src/watch-module.ts')
      writeFileSync(module, 'export const watchModule = "watch-module-sentinel"\n')
      writeFileSync(
        index,
        Buffer.concat([original, Buffer.from('\nexport * from "./watch-module"\n')])
      )
      await waitFor(
        () => hasMarker(directory, 'watchModule', true),
        () => output
      )
      writeFileSync(module, 'export const watchModuleUpdated = "updated"\n')
      await waitFor(
        () => hasMarker(directory, 'watchModuleUpdated', true),
        () => output
      )
      writeFileSync(index, original)
      rmSync(module)
      await waitFor(
        () => hasMarker(directory, 'watchModule', false),
        () => output
      )
      process.kill(-child.pid, 'SIGTERM')
      await exited
      await waitFor(
        () => groupAbsent(child.pid),
        () => 'owned process group remains'
      )
      stopped = true
      assert.equal(hasMarker(directory, 'watchModule', false), true)
    } finally {
      if (child?.pid && !stopped && !groupAbsent(child.pid)) {
        process.kill(-child.pid, 'SIGTERM')
        await waitFor(
          () => groupAbsent(child.pid),
          () => output
        )
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
