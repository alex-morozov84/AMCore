import {
  closeQueueGraph,
  type CompiledQueueGraph,
  compileQueueGraph,
  disableDefaultQueue,
} from './queue-inventory.helper'

/** default disabled, web role (board adapter dropped with it) */
describe('queue inventory — default disabled, web role (board adapter dropped with it)', () => {
  let graph: CompiledQueueGraph

  beforeAll(async () => {
    await disableDefaultQueue()
    graph = await compileQueueGraph('web')
  }, 90000)
  afterAll(() => closeQueueGraph(graph), 60000)

  it('registers exactly the enabled inventory and boots', () => {
    expect(graph.registered).toEqual(['email', 'notifications', 'ai-runs'])
  })

  it('mounts the Bull Board placeholder for this role', () => {
    expect(graph.boardMounted).toBe(true)
  })
})
