import { QUEUE_INVENTORY, type QueueDescriptor } from './constants/queue-inventory.constant'

/** Names that are registered with BullMQ and observed. */
export function enabledQueueNames(
  inventory: readonly QueueDescriptor[] = QUEUE_INVENTORY
): string[] {
  return inventory.filter((queue) => queue.enabled).map((queue) => queue.name)
}

/**
 * Queues that get a Bull Board adapter: exactly the enabled queues, the same rule that puts a row in
 * Background work. A disabled queue is not registered, so the board would resolve a missing token.
 * Registering a queue in the inventory is therefore enough to see it in the board; its job data stays
 * hidden until `BOARD_DATA_PROJECTIONS` names the fields to show.
 */
export function boardQueueNames(inventory: readonly QueueDescriptor[] = QUEUE_INVENTORY): string[] {
  return enabledQueueNames(inventory)
}

/**
 * Whether the queue has an adapter in the read-only queue board. Says nothing about the board being
 * mounted (see `BULL_BOARD_MOUNT`).
 */
export function isOnBoard(descriptor: QueueDescriptor): boolean {
  return descriptor.enabled
}
