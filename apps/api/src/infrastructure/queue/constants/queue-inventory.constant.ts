import { QueueName } from './queues.constant'

/**
 * How a queue is used:
 * - `work`: jobs carry the work itself (email delivery).
 * - `wake`: one-attempt wake jobs that nudge a worker to drain durable Postgres state
 *   (ADR-052/ADR-054); an empty queue does not mean nothing is pending.
 * - `extension`: a generic queue for downstream code; the starter ships no processor.
 */
export type QueueKind = 'work' | 'wake' | 'extension'

export interface QueueDescriptor {
  readonly name: QueueName
  readonly kind: QueueKind
  /**
   * Code-owned intent. `false` removes the registration, the Bull Board adapter and every
   * observation read. It does NOT remove producers or processors: see the queue README.
   */
  readonly enabled: boolean
}

/** Exhaustive by construction: a new `QueueName` without a descriptor fails to compile. */
const DESCRIPTORS = {
  [QueueName.EMAIL]: { kind: 'work', enabled: true },
  [QueueName.DEFAULT]: { kind: 'extension', enabled: true },
  [QueueName.NOTIFICATIONS]: { kind: 'wake', enabled: true },
  [QueueName.AI_RUNS]: { kind: 'wake', enabled: true },
} as const satisfies Record<QueueName, Pick<QueueDescriptor, 'kind' | 'enabled'>>

/** The single queue inventory: registration, `QueueService`, metrics and observation derive from it. */
export const QUEUE_INVENTORY: readonly QueueDescriptor[] = Object.values(QueueName).map((name) => ({
  name,
  ...DESCRIPTORS[name],
}))

/** DI token for the `name -> Queue` map built from the enabled inventory. */
export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY')
