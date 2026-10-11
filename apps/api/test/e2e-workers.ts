import type { CleanupPhase } from './e2e-cleanup'

function absent(error: unknown): boolean {
  return error instanceof Error && error.constructor.name === 'UnknownElementException'
}

export async function closeE2EWorkers<T>(
  bindings: () => readonly T[],
  resolve: (binding: T) => { close: () => Promise<unknown> },
  bound: (phase: CleanupPhase) => Promise<void>,
  milliseconds = 10_000
): Promise<void> {
  let found: readonly T[]
  try {
    found = bindings()
  } catch (error) {
    if (absent(error)) return
    throw error
  }
  const failures: unknown[] = []
  await Promise.all(
    found.map(async (binding, index) => {
      try {
        let worker: ReturnType<typeof resolve>
        try {
          worker = resolve(binding)
        } catch (error) {
          if (absent(error)) return
          throw error
        }
        await bound({ name: `worker-${index}`, run: worker.close, milliseconds })
      } catch (error) {
        failures.push(error)
      }
    })
  )
  if (failures.length) throw new AggregateError(failures, 'Worker close failed')
}
