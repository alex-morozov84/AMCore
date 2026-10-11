import { appendFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

export interface CleanupPhase {
  name: string
  run: () => Promise<unknown> | unknown
  milliseconds: number
}

function record(event: string, phase?: string): void {
  const path = process.env.AMCORE_E2E_PROGRESS
  if (path) {
    appendFileSync(
      path,
      JSON.stringify({ event, phase, attempt: process.env.AMCORE_E2E_ATTEMPT }) + '\n'
    )
  }
}

/** A timeout preserves failure; it does not cancel the original close operation. */
export async function boundedPhase(phase: CleanupPhase): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const operation = Promise.resolve().then(phase.run)
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Cleanup timeout: ${phase.name}`)),
          phase.milliseconds
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function cleanupE2E(phases: CleanupPhase[], deadline = 60_000): Promise<void> {
  record('cleanup-start')
  const began = performance.now()
  const failures: unknown[] = []
  for (const phase of phases) {
    const remaining = deadline - (performance.now() - began)
    record('cleanup-phase', phase.name)
    try {
      await boundedPhase({
        ...phase,
        milliseconds: Math.max(1, Math.min(remaining, phase.milliseconds)),
      })
    } catch (error) {
      failures.push(error)
      record('cleanup-failure', phase.name)
    }
  }
  record(failures.length ? 'cleanup-failed' : 'cleanup-end')
  if (failures.length) throw new AggregateError(failures, 'E2E cleanup failed')
}
