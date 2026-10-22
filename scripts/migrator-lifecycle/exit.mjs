import { setTimeout as delay } from 'node:timers/promises'
import { bounded } from './safety.mjs'

// Start the single delay in the exit callback, independent of stdout close and
// signal-command completion. Do not perform Docker calls or polling here.
export function watchExit(child, started, observe, timing = {}) {
  const now = timing.now ?? (() => performance.now())
  const wait = timing.wait ?? delay
  const cancellation = new globalThis.AbortController()
  const attempt = { child, started, cancellation }
  attempt.closed = new Promise((resolve) =>
    child.once('close', () => {
      attempt.closedConfirmed = true
      resolve()
    })
  )
  attempt.exited = new Promise((resolve) => {
    child.once('error', (error) => {
      attempt.error = error
      resolve({ error })
    })
    child.once('exit', (code, signal) => {
      const exitedAt = now()
      attempt.observed = (async () => {
        try {
          await wait(200, undefined, { signal: cancellation.signal })
          const observationDelayMs = now() - exitedAt
          const result = await observe()
          return {
            result,
            observationDelayMs,
            schedulerDelayMs: observationDelayMs - 200,
            observationCompleteMs: now() - exitedAt,
          }
        } catch (error) {
          return { error }
        }
      })()
      resolve({ code, signal, elapsed: exitedAt - started })
    })
  })
  return attempt
}

export async function naturalExit(attempt) {
  const remaining = 45000 - (performance.now() - attempt.started)
  if (remaining <= 0)
    throw Object.assign(new Error('Original deadline expired'), { code: 'EXIT_TIMEOUT' })
  const exit = await bounded(attempt.exited, remaining, 'EXIT_TIMEOUT')
  if (exit.error) throw exit.error
  return exit
}

export async function closeAttached(attempt, recordFailure) {
  attempt.cancellation.abort()
  try {
    await bounded(attempt.closed, 5000, 'ATTACH_CLOSE_TIMEOUT')
  } catch (error) {
    // The failed lifecycle verdict must already be recorded before this call.
    recordFailure(error)
    attempt.child.kill('SIGKILL')
    attempt.child.stdout?.destroy()
    attempt.child.stderr?.destroy()
    try {
      await bounded(attempt.closed, 2000, 'ATTACH_KILL_TIMEOUT')
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Attached client cleanup failed')
    }
    throw error
  }
}
