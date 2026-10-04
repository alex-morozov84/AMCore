import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { BULL_BOARD_CONTENT_SECURITY_POLICY } from '@amcore/shared'

import { boardCopy, type BoardLocale } from './bull-board-copy'
import { safeErrorResult } from './bull-board-errors'
import { type BoardEventSink, NOOP_BOARD_EVENTS } from './bull-board-events'
import { decideBoardRoute } from './bull-board-route-policy'

/** What an authenticated request leaves for the rest of the chain (set by the admission middleware). */
export interface BoardRequestLocals {
  boardCredential?: 'cookie' | 'bearer'
  boardActorId?: string
  boardContext?: { basePath: string; locale: BoardLocale; returnHref: string }
}

/** Internal request header carrying the validated locale to the response hooks; always overwritten. */
export const BOARD_LOCALE_HEADER = 'x-amcore-board-locale'

/**
 * Headers every response of the mount carries. `setHeader` (not append) so the board's policy
 * replaces whatever an earlier global middleware (e.g. Helmet) already set.
 */
export function applyBoardHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Security-Policy', BULL_BOARD_CONTENT_SECURITY_POLICY)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
}

function sendError(res: Response, status: 400 | 404 | 500): void {
  const result = safeErrorResult(status)
  res.status(status).json(result.body)
}

/**
 * The read-only boundary of the board mount, after authentication and before the Board router:
 * only GET/HEAD, only listed paths, bounded queries, the board's own response headers and CSP, and
 * fixed answers for channels that are never read (job logs). Nothing here depends on the Board
 * being "read-only"; it holds if a future Board version adds a route.
 */
export function createBullBoardBoundary(
  events: BoardEventSink = NOOP_BOARD_EVENTS
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    applyBoardHeaders(res)

    // The locale for the response hooks is ours alone: drop whatever the client sent.
    delete req.headers[BOARD_LOCALE_HEADER]
    const locals = res.locals as BoardRequestLocals
    if (locals.boardContext) req.headers[BOARD_LOCALE_HEADER] = locals.boardContext.locale

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').end()
      return
    }

    const query = new URL(req.originalUrl, 'http://board.invalid').searchParams
    const decision = decideBoardRoute(req.path, query)
    if (decision.kind === 'reject') {
      sendError(res, decision.status)
      return
    }
    if (decision.kind === 'synthetic') {
      // The board's own "this job is not part of a flow" reply; nothing is read.
      res
        .status(200)
        .json(
          decision.channel === 'logs'
            ? [boardCopy(locals.boardContext?.locale).logsHidden]
            : { nodeId: decision.jobId, isFlowNode: false, flowRoot: null }
        )
      return
    }
    if (req.path.startsWith('/static/')) res.setHeader('Cache-Control', 'private, no-cache')
    if (decision.entry) {
      events({
        event: 'bull_board.entry_opened',
        credential: locals.boardCredential ?? 'cookie',
        ...(locals.boardActorId ? { actorId: locals.boardActorId } : {}),
      })
    }
    next()
  }
}

/** Runs the handlers in order, stopping at the first one that responds (Express `use` semantics). */
export function chainBoardMiddleware(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    const run = (index: number): void => {
      const handler = handlers[index]
      if (!handler) {
        next()
        return
      }
      handler(req, res, (error?: unknown) => {
        if (error) next(error)
        else run(index + 1)
      })
    }
    run(0)
  }
}
