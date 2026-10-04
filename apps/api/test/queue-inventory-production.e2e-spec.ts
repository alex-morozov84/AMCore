import { BULL_BOARD_ADAPTER } from '@bull-board/nestjs'
import type { OpenAPIObject } from '@nestjs/swagger'

import {
  closeQueueGraph,
  type CompiledQueueGraph,
  compileQueueGraph,
} from './queue-inventory.helper'

/**
 * The board is NOT mounted in production unless `ENABLE_BULL_BOARD=true` is a real process variable
 * when the modules load. The decision is one startup snapshot; a flag that only a later `.env` load
 * supplies mounts nothing and must not be reported as available.
 */
describe('queue board — production without the process flag', () => {
  let graph: CompiledQueueGraph

  beforeAll(async () => {
    graph = await compileQueueGraph('web', {
      productionAtImport: true,
      lateEnableBullBoard: 'true',
    })
  }, 90000)
  afterAll(() => closeQueueGraph(graph), 60000)

  it('has no board in the module graph, although a later load put the flag in the environment', () => {
    expect(process.env.ENABLE_BULL_BOARD).toBe('true')
    expect(graph.boardMounted).toBe(false)
    expect(() => graph.module.get(BULL_BOARD_ADAPTER, { strict: false })).toThrow()
  })

  it('freezes the decision as disabled in production', async () => {
    const { BULL_BOARD_MOUNT } =
      await import('../src/infrastructure/queue/dashboard/bull-board-mount-state')
    expect(BULL_BOARD_MOUNT).toEqual({ mounted: false, reason: 'disabled_in_production' })
    expect(Object.isFrozen(BULL_BOARD_MOUNT)).toBe(true)
  })

  it('reports the confirmed cause to the Console summary', async () => {
    const { AdminQueuesService } = await import('../src/core/admin/admin-queues.service')
    const summary = await graph.module.get(AdminQueuesService, { strict: false }).list()
    expect(summary.board).toEqual({ state: 'disabled' })
    expect(summary.queues.filter((queue) => queue.inBoard).length).toBe(3)
  })

  it('documents no board operation', async () => {
    const { addQueueBoardOperation } = await import('../src/swagger.config')
    const { BULL_BOARD_MOUNT } =
      await import('../src/infrastructure/queue/dashboard/bull-board-mount-state')
    const document = addQueueBoardOperation(
      { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: {} } as OpenAPIObject,
      BULL_BOARD_MOUNT,
      'api/v1'
    )
    expect(Object.keys(document.paths)).toEqual([])
  })
})
