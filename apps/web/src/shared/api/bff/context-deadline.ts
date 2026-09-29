import 'server-only'

/** Bounds waiting, including Redis/refresh and response parsing; shared refresh may finish CAS. */
export async function withinContextDeadline<T>(
  caller: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  deadlineMs = 5000
): Promise<T> {
  const signal = AbortSignal.any([AbortSignal.timeout(deadlineMs), ...(caller ? [caller] : [])])
  signal.throwIfAborted()
  let onAbort: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work(signal), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort!)
  }
}
