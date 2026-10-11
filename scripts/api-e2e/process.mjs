import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

export function readRows(path, live = false) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  if (!live && text && !text.endsWith('\n')) throw new Error('Truncated incremental report')
  const lines = text.split('\n')
  if (live && !text.endsWith('\n')) lines.pop()
  return lines.filter(Boolean).map((line) => JSON.parse(line))
}

/** One execution spawn; failure latches before termination and cannot be replaced by late PASS. */
export async function supervise(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
    detached: true,
  })
  const result = {
    pid: child.pid,
    spawns: 1,
    closed: false,
    forced: false,
    lifecycleFailure: false,
  }
  options.onState?.(result)
  let terminalAt,
    cleanupAt,
    terminationAt,
    killedAt,
    cleanupIndex = -1
  const began = performance.now()
  let interval
  const force = () => {
    result.forced = true
    options.onState?.(result)
    if (!terminationAt) {
      terminationAt = performance.now()
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* Already exited: close still required. */
      }
    }
  }
  const interrupted = () => {
    result.lifecycleFailure = true
    force()
  }
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        Object.assign(result, { closed: true, exit: code, signal })
        options.onState?.(result)
        resolve()
      })
      interval = setInterval(() => {
        const now = performance.now()
        let rows
        try {
          rows = readRows(options.progress, true)
        } catch {
          result.lifecycleFailure = true
          force()
          return
        }
        if (rows.some((row) => row.event === 'terminal')) terminalAt ??= now
        const index = rows.findLastIndex((row) => row.event === 'cleanup-start')
        if (index > cleanupIndex) {
          cleanupIndex = index
          cleanupAt = now
        }
        if (rows.some((row) => /cleanup-fail/.test(row.event))) result.lifecycleFailure = true
        if (
          now - began > (options.wallMilliseconds ?? 240_000) ||
          (terminalAt && now - terminalAt > (options.exitMilliseconds ?? 5000)) ||
          (cleanupAt &&
            !rows.slice(cleanupIndex).some((row) => row.event === 'cleanup-end') &&
            now - cleanupAt > (options.cleanupMilliseconds ?? 60_000))
        )
          force()
        if (
          terminationAt &&
          !killedAt &&
          now - terminationAt > (options.termMilliseconds ?? 5000)
        ) {
          killedAt = now
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            /* close verification below */
          }
        }
        if (killedAt && now - killedAt > (options.killMilliseconds ?? 2000)) resolve()
      }, options.pollMilliseconds ?? 100)
    })
    // A surviving member of this attempt's group prevents a clean next-suite transition.
    let alive = false
    try {
      process.kill(-child.pid, 0)
      alive = true
    } catch {
      /* No owned group remains. */
    }
    if (alive) {
      result.lifecycleFailure = true
      force()
      await new Promise((resolve) => setTimeout(resolve, options.termMilliseconds ?? 5000))
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* Already exited */
      }
      await new Promise((resolve) => setTimeout(resolve, options.killMilliseconds ?? 2000))
    }
  } finally {
    clearInterval(interval)
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
  }
  return result
}
