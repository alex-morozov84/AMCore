import { writeFileSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { clearTimeout } from 'node:timers'

const allowed = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CI']
export function cleanEnvironment(extra = {}, source = process.env) {
  return {
    ...Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]])),
    NEXT_TELEMETRY_DISABLED: '1',
    HUSKY: '0',
    COMPOSE_PROGRESS: 'plain',
    BUILDKIT_PROGRESS: 'plain',
    ...extra,
  }
}

export const children = new Set()
let journal
let cancelled = false
export const requestCancellation = () => {
  cancelled = true
}
export const allowCleanup = () => {
  cancelled = false
}
export function setJournal(path) {
  journal = path
}
function recordChildren() {
  if (!journal) return
  const tmp = `${journal}.tmp`
  writeFileSync(
    tmp,
    JSON.stringify(
      [...children].map((c) => ({ pid: c.pid, cwd: c.standCwd, started: c.standStarted }))
    ),
    { mode: 0o600 }
  )
  renameSync(tmp, journal)
}
export function run(command, args, { cwd, env = cleanEnvironment(), capture = false, input } = {}) {
  if (cancelled) return Promise.reject(new Error('Stand interrupted; new subprocess refused'))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'pipe'],
    })
    child.standCwd = cwd
    child.standStarted = new Date().toISOString()
    children.add(child)
    recordChildren()
    let output = ''
    let error = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk) => {
      error = (error + chunk).slice(-8000)
      if (!capture) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      children.delete(child)
      recordChildren()
      if (code === 0) resolve(output)
      else {
        const failure = new Error(
          `${command} failed (${signal ?? code})${capture ? `: ${error.trim()}` : ''}`
        )
        failure.stderr = error
        reject(failure)
      }
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

export async function stopChildren() {
  const active = [...children]
  const exits = active.map((child) => new Promise((resolve) => child.once('close', resolve)))
  for (const child of active) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* Child already exited. */
    }
  }
  const timer = setTimeout(() => {
    for (const child of active)
      if (children.has(child)) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Child already exited. */
        }
      }
  }, 5000)
  await Promise.all(exits)
  clearTimeout(timer)
}
