import { execFileSync } from 'node:child_process'

/** Fixed direct CLI only: force termination at the deadline, then preserve failure. */
export function command(binary, args, timeout = 5000) {
  try {
    return {
      value: execFileSync(binary, args, {
        encoding: 'utf8',
        timeout,
        killSignal: 'SIGKILL',
      }).trim(),
    }
  } catch (error) {
    return { value: null, error: error.message, code: error.code, signal: error.signal }
  }
}
