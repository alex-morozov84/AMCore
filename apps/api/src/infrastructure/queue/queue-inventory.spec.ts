import { QUEUE_INVENTORY, type QueueDescriptor } from './constants/queue-inventory.constant'
import { QueueName } from './constants/queues.constant'
import { boardQueueNames, enabledQueueNames } from './queue-inventory'

const disable = (...names: QueueName[]): QueueDescriptor[] =>
  QUEUE_INVENTORY.map((queue) =>
    names.includes(queue.name) ? { ...queue, enabled: false } : queue
  )

describe('queue inventory', () => {
  it('describes every QueueName exactly once, all enabled in the stock build', () => {
    expect(QUEUE_INVENTORY.map((queue) => queue.name)).toEqual(Object.values(QueueName))
    expect(QUEUE_INVENTORY.every((queue) => queue.enabled)).toBe(true)
  })

  it('classifies the stock queues by what an empty queue means', () => {
    const kinds = Object.fromEntries(QUEUE_INVENTORY.map((queue) => [queue.name, queue.kind]))
    expect(kinds).toEqual({
      email: 'work',
      default: 'extension',
      notifications: 'wake',
      'ai-runs': 'wake',
    })
  })

  it('registers only enabled queues', () => {
    expect(enabledQueueNames()).toEqual(Object.values(QueueName))
    expect(enabledQueueNames(disable(QueueName.DEFAULT))).not.toContain(QueueName.DEFAULT)
  })

  it('puts every enabled queue on the board, the same rule as the Background work rows', () => {
    expect(boardQueueNames()).toEqual(enabledQueueNames())
    expect(boardQueueNames()).toContain(QueueName.AI_RUNS)
  })

  it('drops a board adapter for a disabled queue so the board cannot resolve a missing token', () => {
    expect(boardQueueNames(disable(QueueName.DEFAULT))).not.toContain(QueueName.DEFAULT)
    expect(boardQueueNames(disable(QueueName.AI_RUNS))).not.toContain(QueueName.AI_RUNS)
    expect(boardQueueNames(disable(QueueName.AI_RUNS))).toContain(QueueName.EMAIL)
  })
})
