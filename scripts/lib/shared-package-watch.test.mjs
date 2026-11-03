import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { copyShared, observeSharedBuilds } from './shared-package-fixture.mjs'

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
    let buildStart = 0
    const completed = () => {
      const recent = output.slice(buildStart)
      return ['es', 'cjs'].every((format) => recent.includes(`SHARED_BUILD_DONE:${format}`))
    }
    const waitForBuild = (marker, expected) =>
      waitFor(
        () => completed() && hasMarker(directory, marker, expected),
        () => output
      )
    try {
      copyShared(directory)
      observeSharedBuilds(directory)
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
      await waitForBuild('registerSchema', true)
      const index = join(directory, 'src/index.ts')
      const original = readFileSync(index)
      const module = join(directory, 'src/watch-module.ts')
      buildStart = output.length
      writeFileSync(module, 'export const watchModule = "watch-module-sentinel"\n')
      writeFileSync(
        index,
        Buffer.concat([original, Buffer.from('\nexport * from "./watch-module"\n')])
      )
      await waitForBuild('watchModule', true)
      buildStart = output.length
      writeFileSync(module, 'export const watchModuleUpdated = "updated"\n')
      await waitForBuild('watchModuleUpdated', true)
      buildStart = output.length
      writeFileSync(index, original)
      // Remove the import first; deleting a still-watched dependency can queue another build.
      await waitForBuild('watchModule', false)
      buildStart = output.length
      rmSync(module)
      // Force a final rebuild even when the watcher has already dropped the removed file.
      writeFileSync(index, Buffer.concat([original, Buffer.from('\n')]))
      await waitForBuild('watchModule', false)
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
