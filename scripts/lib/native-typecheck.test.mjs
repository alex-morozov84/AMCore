import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const helper = resolve('scripts/typecheck-native.mjs')
function fixture(version = '7.0.2', body = 'console.log(JSON.stringify(process.argv.slice(2)))') {
  const root = mkdtempSync(join(tmpdir(), 'native-check-'))
  writeFileSync(join(root, 'package.json'), '{}')
  const pkg = join(root, 'node_modules/@typescript/native')
  mkdirSync(join(pkg, 'bin'), { recursive: true })
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'typescript', version, bin: { tsc: 'bin/tsc.cjs' } })
  )
  writeFileSync(join(pkg, 'bin/tsc.cjs'), body)
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('native CLI resolves alias from package cwd, preserves arguments and exit failure', () => {
  const f = fixture()
  try {
    const run = spawnSync(process.execPath, [helper, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: f.root,
      encoding: 'utf8',
    })
    assert.equal(run.status, 0)
    assert.deepEqual(JSON.parse(run.stdout), ['--noEmit', '-p', 'tsconfig.json'])
    writeFileSync(
      join(f.root, 'node_modules/@typescript/native/bin/tsc.cjs'),
      'process.exitCode = 2'
    )
    assert.equal(spawnSync(process.execPath, [helper], { cwd: f.root }).status, 2)
  } finally {
    f.cleanup()
  }
})

test('missing or wrong native alias refuses rather than selects legacy compiler', () => {
  const f = fixture('5.9.3')
  try {
    assert.notEqual(spawnSync(process.execPath, [helper], { cwd: f.root }).status, 0)
    rmSync(join(f.root, 'node_modules'), { recursive: true })
    assert.notEqual(spawnSync(process.execPath, [helper], { cwd: f.root }).status, 0)
  } finally {
    f.cleanup()
  }
})

test('interruption stops public wrapper and its fallback child, with non-success exit', async () => {
  const f = fixture(
    '7.0.2',
    `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});require("node:fs").writeFileSync("child.pid",String(process.pid));setInterval(()=>{},100)'],{stdio:'inherit'});setInterval(()=>{},100)`
  )
  let child, compilerPid
  try {
    child = spawn(process.execPath, [helper], { cwd: f.root, stdio: 'ignore' })
    const exited = new Promise((done, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => done({ code, signal }))
    })
    for (let i = 0; i < 100; i++) {
      try {
        compilerPid = Number(readFileSync(join(f.root, 'child.pid')))
        break
      } catch {
        await delay(20)
      }
    }
    assert.ok(compilerPid)
    child.kill('SIGTERM')
    const result = await exited
    assert.notEqual(result.code, 0)
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(compilerPid, 0)
        await delay(20)
      } catch (error) {
        assert.equal(error.code, 'ESRCH')
        return
      }
    }
    assert.fail('owned fallback compiler survived cancellation')
  } finally {
    if (compilerPid)
      try {
        process.kill(compilerPid, 'SIGKILL')
      } catch {
        // The compiler may already have exited.
      }
    if (child) child.kill('SIGKILL')
    f.cleanup()
  }
})

test('real native CLI rejects bad config and invalidates its own incremental cache', () => {
  const f = fixture()
  try {
    rmSync(join(f.root, 'node_modules/@typescript/native'), { recursive: true })
    const native = resolve('apps/api/node_modules/@typescript/native')
    // The fixture selects exactly the declared package; no global executable lookup.
    symlinkSync(native, join(f.root, 'node_modules/@typescript/native'), 'dir')
    writeFileSync(join(f.root, 'value.ts'), 'const value: string = "valid";')
    const config = {
      compilerOptions: {
        noEmit: true,
        strict: true,
        incremental: true,
        tsBuildInfoFile: '.amcore/typescript7/check.tsbuildinfo',
        types: [],
        target: 'ES2022',
      },
      files: ['value.ts'],
    }
    writeFileSync(join(f.root, 'tsconfig.json'), JSON.stringify(config))
    const check = () =>
      spawnSync(
        process.execPath,
        [helper, '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'],
        { cwd: f.root, encoding: 'utf8' }
      )
    assert.equal(check().status, 0)
    const cache = join(f.root, '.amcore/typescript7/check.tsbuildinfo')
    const before = readFileSync(cache, 'utf8')
    writeFileSync(join(f.root, 'value.ts'), 'const value: string = 42;')
    const bad = check()
    assert.notEqual(bad.status, 0)
    assert.match(bad.stdout, /TS2322/)
    writeFileSync(join(f.root, 'value.ts'), 'const value: string = "valid";')
    assert.equal(check().status, 0)
    config.compilerOptions.strict = false
    writeFileSync(join(f.root, 'tsconfig.json'), JSON.stringify(config))
    assert.equal(check().status, 0)
    assert.notEqual(readFileSync(cache, 'utf8'), before)
    writeFileSync(cache, before.replaceAll('7.0.2', '0.0.0'))
    assert.equal(check().status, 0)
    assert.match(readFileSync(cache, 'utf8'), /7\.0\.2/)
    writeFileSync(join(f.root, 'tsconfig.json'), '{bad')
    assert.notEqual(check().status, 0)
  } finally {
    f.cleanup()
  }
})
