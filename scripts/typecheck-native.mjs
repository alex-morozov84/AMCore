import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

const require = createRequire(resolve('package.json'))
const manifestPath = require.resolve('@typescript/native/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.name !== 'typescript' || manifest.version !== '7.0.2' || !manifest.bin?.tsc)
  throw new Error('Install the declared @typescript/native alias (TypeScript 7.0.2)')

const child = spawn(
  process.execPath,
  [join(dirname(manifestPath), manifest.bin.tsc), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  }
)
let interrupted
let deadline
function stop(signal) {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      if (result.error) throw result.error
    } else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = signal
    stop(signal)
    deadline ??= setTimeout(() => stop('SIGKILL'), 1500)
  })
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  if (interrupted) stop('SIGKILL')
  clearTimeout(deadline)
  process.exitCode = interrupted || signal ? 1 : (code ?? 1)
})
