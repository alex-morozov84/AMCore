/**
 * Realtime transport constants (ADR-053, Track B Arc C). These are versioned in
 * code, NOT operator knobs — the tunable values live in `env.ts`
 * (`NOTIFICATIONS_REALTIME_*`). The channel is environment- and version-namespaced;
 * deployments that share one Redis stay isolated **only if each sets a distinct
 * `NOTIFICATIONS_REALTIME_NAMESPACE`** — an empty namespace with the same `NODE_ENV`
 * resolves to the same channel (see `composeRealtimeChannel`).
 */

/** Channel version — bump only on an incompatible envelope change. */
export const NOTIFICATION_REALTIME_CHANNEL_VERSION = 'v1'

/** Channel base token; full channel = `<env>[:<namespace>]:notif:rt:<version>`. */
export const NOTIFICATION_REALTIME_CHANNEL_BASE = 'notif:rt'

/**
 * Hard cap on a raw Pub/Sub message before it is parsed (bytes). A cheap guard so
 * a malformed/oversized payload is dropped without allocating a large object.
 */
export const NOTIFICATION_REALTIME_ENVELOPE_MAX_BYTES = 512

/**
 * Max time to wait for the subscriber's UNSUBSCRIBE acknowledgement before forcing
 * `destroy()`. The deadline runs while the client is still open; after the ACK its
 * command queue is empty and `close()` can safely destroy the socket.
 */
export const NOTIFICATION_REALTIME_SHUTDOWN_DEADLINE_MS = 2000

/**
 * Compose the environment- and version-namespaced Pub/Sub channel. `namespace`
 * (operator-set, may be empty) distinguishes deployments that share one Redis —
 * `NODE_ENV` alone cannot separate staging from production. Empty namespace ⇒
 * `<env>:notif:rt:v1`; set ⇒ `<env>:<namespace>:notif:rt:v1`. Web and worker both
 * call this with the same inputs, so they resolve the same channel.
 */
export function composeRealtimeChannel(nodeEnv: string, namespace: string): string {
  return [
    nodeEnv,
    namespace,
    NOTIFICATION_REALTIME_CHANNEL_BASE,
    NOTIFICATION_REALTIME_CHANNEL_VERSION,
  ]
    .filter((segment) => segment.length > 0)
    .join(':')
}
