import {
  BULL_BOARD_QUEUE_NAMES,
  QUEUE_INVENTORY,
  type QueueDescriptor,
} from './constants/queue-inventory.constant'
import type { QueueName } from './constants/queues.constant'

/** Names that are registered with BullMQ and observed. */
export function enabledQueueNames(
  inventory: readonly QueueDescriptor[] = QUEUE_INVENTORY
): QueueName[] {
  return inventory.filter((queue) => queue.enabled).map((queue) => queue.name)
}

/** Bull Board adapters exist only for enabled queues, or its bootstrap would resolve a missing token. */
export function boardQueueNames(
  inventory: readonly QueueDescriptor[] = QUEUE_INVENTORY,
  boardQueues: readonly QueueName[] = BULL_BOARD_QUEUE_NAMES
): QueueName[] {
  const enabled = new Set(enabledQueueNames(inventory))
  return boardQueues.filter((name) => enabled.has(name))
}
