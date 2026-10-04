import {
  closeQueueGraph,
  type CompiledQueueGraph,
  compileQueueGraph,
  STOCK_QUEUES,
} from './queue-inventory.helper'

/** stock graph, worker role (board never mounted) */
describe('queue inventory — stock graph, worker role (board never mounted)', () => {
  let graph: CompiledQueueGraph

  beforeAll(async () => {
    graph = await compileQueueGraph('worker')
  }, 90000)
  afterAll(() => closeQueueGraph(graph), 60000)

  it('registers exactly the enabled inventory and boots', () => {
    expect(graph.registered).toEqual(STOCK_QUEUES)
  })

  it('does not mount the Bull Board for this role', () => {
    expect(graph.boardMounted).toBe(false)
  })
})
