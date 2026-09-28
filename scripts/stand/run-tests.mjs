import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { root } from './state.mjs'
import { cleanEnvironment } from './process.mjs'

const files = (await readdir(import.meta.dirname))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(import.meta.dirname, name))
const args = process.argv.slice(2)
const linux = args.includes('--linux-startup-proof')
const result = spawnSync(
  process.execPath,
  ['--test', ...args.filter((arg) => arg !== '--linux-startup-proof'), ...files],
  {
    cwd: root,
    env: cleanEnvironment(linux ? { AMCORE_LINUX_PROOF: '1' } : {}),
    stdio: 'inherit',
  }
)
if (result.error) throw result.error
if (result.signal) process.kill(process.pid, result.signal)
else process.exitCode = result.status ?? 1
