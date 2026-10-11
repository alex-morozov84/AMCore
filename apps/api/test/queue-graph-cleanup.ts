import type { CleanupPhase } from './e2e-cleanup'

interface ClosableQueueGraph {
  module: { close: () => Promise<unknown> }
  redis: { stop: (options: { timeout: number }) => Promise<unknown> }
}

/** Keep real close failures while attempting every owned resource. */
export async function closeOwnedQueueGraph(
  graph: ClosableQueueGraph | undefined,
  cleanup: (phases: CleanupPhase[]) => Promise<void>,
  milliseconds = 10_000
): Promise<void> {
  if (!graph) return
  await cleanup([
    { name: 'queue-module', milliseconds, run: () => graph.module.close() },
    { name: 'queue-redis', milliseconds, run: () => graph.redis.stop({ timeout: 10_000 }) },
  ])
}
