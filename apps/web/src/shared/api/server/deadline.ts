import 'server-only'

export interface DeadlineController {
  signal: AbortSignal
  isCallerCancelled: () => boolean
  /** Must be called on every exit path (success, throw, or degrade) - not
   *  only on abort - or the underlying timer outlives the call. */
  cleanup: () => void
}

/**
 * One `AbortSignal` that fires on whichever comes first: `timeoutMs`
 * elapsing, or `callerSignal` aborting. `isCallerCancelled()` distinguishes
 * the two afterward, since a caller's own cancellation must be rethrown
 * (their business, not a backend availability signal) while our own
 * deadline classifies as `'timeout'`.
 */
export function createDeadlineController(
  timeoutMs: number,
  callerSignal?: AbortSignal
): DeadlineController {
  const controller = new AbortController()
  const deadline = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('deadline exceeded', 'TimeoutError'))
    }
  }, timeoutMs)

  let callerCancelled = callerSignal?.aborted ?? false
  const onCallerAbort = () => {
    if (controller.signal.aborted) return
    callerCancelled = true
    controller.abort(callerSignal?.reason)
  }
  if (callerCancelled) {
    controller.abort(callerSignal?.reason)
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  }

  return {
    signal: controller.signal,
    isCallerCancelled: () => callerCancelled,
    cleanup: () => {
      clearTimeout(deadline)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

/** Races `promise` against `signal` so a deadline bounds work that isn't
 *  itself cancellable (session/token resolution has no signal parameter). */
export function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}
