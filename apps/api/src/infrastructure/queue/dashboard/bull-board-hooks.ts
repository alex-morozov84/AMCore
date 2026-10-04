import type { BoardHooks, UIConfig } from '@bull-board/api/typings/app'

import { BOARD_LOCALE_HEADER } from './bull-board-boundary.middleware'
import { boardCopy, type BoardLocale } from './bull-board-copy'
import { projectJobBody, projectQueuesBody } from './bull-board-projection'

/** Board routes (as the Board names them) that may run at all; everything else is denied up front. */
const ALLOWED_ROUTES: ReadonlyMap<string, 'queues' | 'job' | 'logs'> = new Map([
  ['/api/queues', 'queues'],
  ['/api/queues/:queueName/:jobId', 'job'],
  ['/api/queues/:queueName/:jobId/logs', 'logs'],
])

function localeOf(
  headers: Record<string, string | undefined> | undefined
): BoardLocale | undefined {
  const value = headers?.[BOARD_LOCALE_HEADER]
  return value === 'ru' || value === 'en' ? value : undefined
}

/**
 * Hooks of the Board's own handler pipeline (`handlerHooks`). `before` is a second, independent deny
 * (the HTTP boundary already filtered by method and path); `after` is where every allowed response
 * is rebuilt by the closed projection BEFORE the Board validates it against its schema.
 */
export const BOARD_HOOKS: BoardHooks = {
  before: ({ method, route }) =>
    method === 'get' && ALLOWED_ROUTES.has(route)
      ? { allow: true }
      : { allow: false, status: method === 'get' ? 404 : 405 },

  after: (context, result) => {
    const kind = ALLOWED_ROUTES.get(context.route)
    const projection = { locale: localeOf(context.request?.headers) }
    if (kind === 'queues') {
      return { status: result.status, body: projectQueuesBody(result.body, projection) }
    }
    if (kind === 'job') {
      return {
        status: result.status,
        body: projectJobBody(result.body, context.request?.params?.queueName, projection),
      }
    }
    // `logs` is answered by the boundary without reading them; if it ever reaches here, still no raw lines.
    return { status: 200, body: [boardCopy(projection.locale).logsHidden] }
  },
}

/** Static UI configuration of the board: what to hide, how often to poll. Per-request fields are added by the adapter. */
export const BOARD_UI_CONFIG: UIConfig = {
  hideRedisDetails: true,
  showWorkers: false,
  showMetrics: false,
  hideDocsLink: true,
  // Seconds. The default of 5 is a Redis read burst per tab; the board is a view, not a live tail.
  pollingInterval: { showSetting: false, forceInterval: 15 },
}
