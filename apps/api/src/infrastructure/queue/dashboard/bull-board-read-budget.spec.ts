import type { AppControllerRoute, BullBoardRequest } from '@bull-board/api/typings/app'
import { jest } from '@jest/globals'

import { withBoardReadBudget } from './bull-board-read-budget'

function requestWith(adapter: object, count: number): BullBoardRequest {
  return {
    queues: new Map(
      Array.from({ length: count }, (_, index) => [String(index), adapter])
    ) as BullBoardRequest['queues'],
    uiConfig: {},
    query: {},
    params: {},
    body: {},
    headers: {},
  }
}

describe('Board per-request bounded read budget', () => {
  afterEach(() => jest.restoreAllMocks())

  it('serializes eight queues and preserves adapter method receivers without a second pool', async () => {
    let active = 0
    let maximum = 0
    const adapter = {
      value: 7,
      async getJobCounts() {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return { failed: this.value }
      },
    }
    const handler: AppControllerRoute['handler'] = async (request) => ({
      body: {
        counts: await Promise.all(
          [...request!.queues.values()].map((queue) => queue.getJobCounts())
        ),
      },
    })
    const result = await withBoardReadBudget(handler)(requestWith(adapter, 8))
    expect(result.body).toEqual({ counts: Array.from({ length: 8 }, () => ({ failed: 7 })) })
    expect(maximum).toBe(1)
    expect(active).toBe(0)
  })

  it('refuses an oversized registration set before invoking any reader', async () => {
    const handler = jest.fn<AppControllerRoute['handler']>()
    await expect(withBoardReadBudget(handler)(requestWith({}, 65))).rejects.toThrow('READ_LIMIT')
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not begin queued reads after the fixed elapsed deadline', async () => {
    let elapsed = 0
    jest.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const read = jest.fn(async () => {
      elapsed = 15_000
      return {}
    })
    const handler: AppControllerRoute['handler'] = async (request) => ({
      body: {
        counts: await Promise.all(
          [...request!.queues.values()].map((queue) => queue.getJobCounts())
        ),
      },
    })
    await expect(
      withBoardReadBudget(handler)(requestWith({ getJobCounts: read }, 2))
    ).rejects.toThrow('READ_LIMIT')
    expect(read).toHaveBeenCalledTimes(1)
  })
})
