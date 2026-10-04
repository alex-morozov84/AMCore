import {
  closeQueueGraph,
  type CompiledQueueGraph,
  compileQueueGraph,
  STOCK_QUEUES,
} from './queue-inventory.helper'

/** stock graph, web role (board mounted outside production) */
describe('queue inventory — stock graph, web role (board mounted outside production)', () => {
  let graph: CompiledQueueGraph

  beforeAll(async () => {
    graph = await compileQueueGraph('web')
  }, 90000)
  afterAll(() => closeQueueGraph(graph), 60000)

  it('registers exactly the enabled inventory and boots', () => {
    expect(graph.registered).toEqual(STOCK_QUEUES)
  })

  it('mounts the Bull Board for this role', () => {
    expect(graph.boardMounted).toBe(true)
  })
})
