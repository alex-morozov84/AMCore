/** A hook may finish late, but may never keep an admission waiting past its bounded signal. */
export function boundedToolHook<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation()
  if (signal.aborted) return Promise.reject(new Error('tool_hook_aborted'))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(new Error('tool_hook_aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
    let pending: Promise<T>
    try {
      pending = operation()
    } catch (error) {
      pending = Promise.reject(error)
    }
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
