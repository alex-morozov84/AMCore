import { provisioningError } from './provisioning-error.js'

const DEADLINE_MS = 250

export interface ProvisioningAdmissionClock {
  now(): number
  schedule(callback: () => void, milliseconds: number): () => void
}
const runtimeClock: ProvisioningAdmissionClock = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds)
    return () => clearTimeout(timer)
  },
}

/** Bounds only Redis waiting. Callers await this before any domain write. */
export function provisioningAdmissionDeadline<T>(
  enqueue: (signal: AbortSignal) => Promise<T>,
  clock: ProvisioningAdmissionClock = runtimeClock
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const deadline = clock.now() + DEADLINE_MS
    let settled = false
    const finish = (outcome: { value: T } | { error: unknown }): void => {
      if (settled) return
      settled = true
      cancelTimer()
      if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.value)
    }
    const expire = (): void => {
      finish({ error: provisioningError('PROVISIONING_ADMISSION_UNAVAILABLE', 503) })
      controller.abort()
    }
    const cancelTimer = clock.schedule(expire, DEADLINE_MS)
    try {
      // Both handlers are attached immediately; neither captures a transaction or domain callback.
      void enqueue(controller.signal).then(
        (value) => {
          if (clock.now() >= deadline) expire()
          else finish({ value })
        },
        () => finish({ error: provisioningError('PROVISIONING_ADMISSION_UNAVAILABLE', 503) })
      )
    } catch {
      finish({ error: provisioningError('PROVISIONING_ADMISSION_UNAVAILABLE', 503) })
      controller.abort()
    }
  })
}
