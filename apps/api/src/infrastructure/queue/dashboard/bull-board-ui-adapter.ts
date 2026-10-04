import type { AppControllerRoute, AppViewRoute, UIConfig } from '@bull-board/api/typings/app'
import { ExpressAdapter } from '@bull-board/express'
import type { Request, Response } from 'express'

import type { BoardRequestLocals } from './bull-board-boundary.middleware'
import { boardCopy, boardLanguage } from './bull-board-copy'
import { safeErrorResult, withFinalBoundary } from './bull-board-errors'

const ENVIRONMENT_COLOR = { color: '#334155', textColor: '#f8fafc' } as const

function sendSafeFailure(res: Response): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  ;(res.locals as { boardRenderFailed?: boolean }).boardRenderFailed = true
  res.status(500).json(safeErrorResult(500).body)
}

function sendHtml(res: Response, html: string): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.status(200).type('html').send(html)
}

/**
 * The queue board's Express adapter: the stock `ExpressAdapter` plus three seams.
 *
 * 1. `setApiRoutes` wraps every route handler in the FINAL boundary (`withFinalBoundary`), which sees
 *    the result after the Board's response validation and reduces any error to `{ error: { key } }`.
 * 2. `setErrorHandler` ignores the Board's handler (it answers with the raw exception message).
 * 3. `setEntryRoute` renders the HTML shell per request: public base path, language, a permanent
 *    read-only label and the way back to the Console come from the request's validated render context
 *    (never from global state), and a render failure — synchronous or asynchronous — is answered with
 *    a fixed 500 instead of being handed to `next(err)`.
 */
export class QueueBoardAdapter extends ExpressAdapter {
  override setApiRoutes(routes: AppControllerRoute[]): ExpressAdapter {
    return super.setApiRoutes(
      routes.map((route) => ({
        ...route,
        handler: withFinalBoundary(route.handler) as AppControllerRoute['handler'],
      }))
    )
  }

  override setErrorHandler(_handler: Parameters<ExpressAdapter['setErrorHandler']>[0]): this {
    return super.setErrorHandler(() => safeErrorResult(500))
  }

  override setEntryRoute(routeDef: AppViewRoute): ExpressAdapter {
    this.app.get(routeDef.route, (req: Request, res: Response) => {
      const context = (res.locals as BoardRequestLocals).boardContext
      let view: ReturnType<AppViewRoute['handler']>
      try {
        view = routeDef.handler({
          basePath: context?.basePath ?? this.basePath,
          uiConfig: this.uiConfigFor(context),
        })
        res.render(view.name, view.params, (error: Error | null, html?: string) => {
          if (error || typeof html !== 'string') sendSafeFailure(res)
          else sendHtml(res, html)
        })
      } catch {
        sendSafeFailure(res)
      }
    })
    return this
  }

  /** A per-request COPY: the adapter's own `uiConfig` is shared by every request and never mutated. */
  private uiConfigFor(context: BoardRequestLocals['boardContext']): UIConfig {
    const copy = boardCopy(context?.locale)
    return {
      ...this.uiConfig,
      boardTitle: copy.boardTitle,
      environment: { label: copy.readOnlyLabel, ...ENVIRONMENT_COLOR },
      locale: { lng: boardLanguage(context?.locale) },
      ...(context ? { miscLinks: [{ text: copy.backToConsole, url: context.returnHref }] } : {}),
    }
  }
}
