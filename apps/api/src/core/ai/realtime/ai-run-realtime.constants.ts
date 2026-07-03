/**
 * AI run-status realtime transport constants (Track C — ADR-054, Arc C.5; ADR-053 status-only SSE).
 * An AI-scoped copy of the notification realtime primitives (the locked decision: duplicate a thin
 * stack now, extract a generic seam only once a second consumer proves it). Versioned in code, NOT
 * operator knobs — the tunable values live in `env.ts` (`AI_REALTIME_*`). The channel is
 * environment- and version-namespaced; deployments sharing one Redis stay isolated **only if each
 * sets a distinct `AI_REALTIME_NAMESPACE`** (an empty namespace with the same `NODE_ENV` resolves
 * to the same channel).
 */

/** Channel version — bump only on an incompatible envelope change. */
export const AI_RUN_REALTIME_CHANNEL_VERSION = 'v1'

/** Channel base token; full channel = `<env>[:<namespace>]:ai:run:rt:<version>`. */
export const AI_RUN_REALTIME_CHANNEL_BASE = 'ai:run:rt'

/**
 * Hard cap on a raw Pub/Sub message before it is parsed (bytes). A cheap guard so a malformed/
 * oversized payload is dropped without allocating a large object.
 */
export const AI_RUN_REALTIME_ENVELOPE_MAX_BYTES = 512

/**
 * Max time to wait for the subscriber's UNSUBSCRIBE acknowledgement before forcing `destroy()`. The
 * deadline runs while the client is still open; after the ACK its command queue is empty and
 * `close()` can safely destroy the socket.
 */
export const AI_RUN_REALTIME_SHUTDOWN_DEADLINE_MS = 2000

/**
 * Compose the environment- and version-namespaced Pub/Sub channel. `namespace` (operator-set, may
 * be empty) distinguishes deployments that share one Redis — `NODE_ENV` alone cannot separate
 * staging from production. Empty namespace ⇒ `<env>:ai:run:rt:v1`; set ⇒
 * `<env>:<namespace>:ai:run:rt:v1`. Web (subscriber) and worker (publisher) both call this with the
 * same inputs, so they resolve the same channel.
 */
export function composeAiRunRealtimeChannel(nodeEnv: string, namespace: string): string {
  return [nodeEnv, namespace, AI_RUN_REALTIME_CHANNEL_BASE, AI_RUN_REALTIME_CHANNEL_VERSION]
    .filter((segment) => segment.length > 0)
    .join(':')
}
