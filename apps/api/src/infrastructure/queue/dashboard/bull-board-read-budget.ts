import type { AppControllerRoute, BullBoardRequest } from '@bull-board/api/typings/app'

import { CONTROL_LIMITS } from '../../background-work/control-limits'

const READ_METHODS = new Set(['getJobCounts', 'isPaused', 'getJobs', 'getJob'])

/** Serialize the installed handler's per-queue fan-out inside one bounded request, not a pool. */
export function withBoardReadBudget(
  handler: AppControllerRoute['handler']
): AppControllerRoute['handler'] {
  return async (request?: BullBoardRequest) => {
    if (!request) throw new Error('INVALID_BOARD_REQUEST')
    if (request.queues.size > CONTROL_LIMITS.registeredWorks) throw new Error('READ_LIMIT')
    const started = performance.now()
    let pending: Promise<unknown> = Promise.resolve()
    let reads = 0
    const queues = new Map(
      [...request.queues].map(([name, adapter]) => [
        name,
        new Proxy(adapter, {
          get(target, property, receiver) {
            const value: unknown = Reflect.get(target, property, receiver)
            if (typeof value !== 'function') return value
            if (!READ_METHODS.has(String(property))) return value.bind(target)
            return (...args: unknown[]) => {
              if (++reads > CONTROL_LIMITS.registeredWorks * 2 + 2) throw new Error('READ_LIMIT')
              const result = pending.then(() => {
                if (performance.now() - started >= CONTROL_LIMITS.batchDeadlineMs)
                  throw new Error('READ_LIMIT')
                return Reflect.apply(value, target, args) as Promise<unknown>
              })
              pending = result
              return result
            }
          },
        }),
      ])
    )
    return handler({ ...request, queues })
  }
}
