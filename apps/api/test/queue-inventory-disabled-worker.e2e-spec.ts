import {
  closeQueueGraph,
  type CompiledQueueGraph,
  compileQueueGraph,
  disableDefaultQueue,
} from './queue-inventory.helper'

/** default disabled, worker role */
describe('queue inventory — default disabled, worker role', () => {
  let graph: CompiledQueueGraph

  beforeAll(async () => {
    await disableDefaultQueue()
    graph = await compileQueueGraph('worker')
  }, 90000)
  afterAll(() => closeQueueGraph(graph), 60000)

  it('registers exactly the enabled inventory and boots', () => {
    expect(graph.registered).toEqual(['email', 'notifications', 'ai-runs'])
  })

  it('does not mount the Bull Board placeholder for this role', () => {
    expect(graph.boardMounted).toBe(false)
  })
})
