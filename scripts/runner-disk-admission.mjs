import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const path = fileURLToPath(import.meta.url)
const stringify = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))

export async function supervisedProbe(args, milliseconds = 5000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = '',
      expired = false,
      overflow = false,
      cancelled = false
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* The child may already have exited. */
      }
    }
    const cancel = () => {
      cancelled = true
      stop()
    }
    process.once('SIGTERM', cancel)
    process.once('SIGINT', cancel)
    process.once('exit', stop)
    const timer = setTimeout(() => {
      expired = true
      stop()
    }, milliseconds)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.length > 16384) {
        overflow = true
        stop()
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ skip: false, reason: 'probe-spawn-error' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      process.removeListener('SIGTERM', cancel)
      process.removeListener('SIGINT', cancel)
      process.removeListener('exit', stop)
      if (overflow) return resolve({ skip: false, reason: 'probe-output-limit' })
      if (cancelled) return resolve({ skip: false, reason: 'probe-cancelled' })
      if (expired || code !== 0)
        return resolve({ skip: false, reason: expired ? 'probe-timeout' : 'probe-error' })
      try {
        const value = JSON.parse(output)
        if (!value || typeof value !== 'object' || typeof value.skip !== 'boolean')
          throw new Error('Invalid probe decision')
        resolve(value)
      } catch {
        resolve({ skip: false, reason: 'invalid-probe-output' })
      }
    })
  })
}

if (process.argv[1] === path) {
  if (process.argv[2] === '--probe') {
    try {
      const { probe } = await import('./runner-disk/probe.mjs')
      console.log(stringify(probe(process.argv[3])))
    } catch {
      console.log(stringify({ skip: false, reason: 'probe-error' }))
    }
  } else {
    const decision = await supervisedProbe([path, '--probe', process.argv[2] ?? ''])
    console.log(stringify({ diskCleanup: decision.skip === true ? 'skip' : 'delete', ...decision }))
    process.exitCode = decision.skip === true ? 0 : 1
  }
}
