import type { AppControllerRoute, AppViewRoute, UIConfig } from '@bull-board/api/typings/app'
import { ExpressAdapter } from '@bull-board/express'
import type { NextFunction, Request, Response } from 'express'

import type { BoardRequestLocals } from './bull-board-boundary.middleware'
import { boardCopy, boardLanguage } from './bull-board-copy'
import { installBoardDisplayAssets, withBoardDisplayStyle } from './bull-board-display-assets'
import { clientErrorStatus, safeErrorResult, withFinalBoundary } from './bull-board-errors'
import { withBoardReadBudget } from './bull-board-read-budget'

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
 * The queue board's Express adapter: the stock `ExpressAdapter` plus four seams.
 *
 * 1. `setApiRoutes` wraps every route handler in the FINAL boundary (`withFinalBoundary`), which sees
 *    the result after the Board's response validation and reduces any error to `{ error: { key } }`.
 * 2. `setErrorHandler` ignores the Board's handler (it answers with the raw exception message).
 * 3. `setEntryRoute` renders the HTML shell per request: public base path, language, a permanent
 *    read-only label and the way back to the Console come from the request's validated render context
 *    (never from global state), and a render failure — synchronous or asynchronous — is answered with
 *    a fixed 500 instead of being handed to `next(err)`.
 * 4. `getRouter` ends the router with a terminal 404 and an error handler. A request that no board
 *    route and no static file answers (a missing asset) would otherwise fall out of the mount into the
 *    application's general not-found handling, whose answer names the requested URL.
 */
export class QueueBoardAdapter extends ExpressAdapter {
  private terminated = false

  override setStaticPath(route: string, directory: string): ExpressAdapter {
    installBoardDisplayAssets(this.app, route, directory)
    return super.setStaticPath(route, directory)
  }

  override getRouter(): ReturnType<ExpressAdapter['getRouter']> {
    const router = super.getRouter()
    if (!this.terminated) {
      this.terminated = true
      router.use((_req: Request, res: Response) => {
        res.status(404).json(safeErrorResult(404).body)
      })
      router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) {
          next(error)
          return
        }
        const status = clientErrorStatus(error)
        res.status(status).json(safeErrorResult(status).body)
      })
    }
    return router
  }

  override setApiRoutes(routes: AppControllerRoute[]): ExpressAdapter {
    return super.setApiRoutes(
      routes.map((route) => ({
        ...route,
        handler: withFinalBoundary(
          withBoardReadBudget(route.handler)
        ) as AppControllerRoute['handler'],
      }))
    )
  }

  override setErrorHandler(_handler: Parameters<ExpressAdapter['setErrorHandler']>[0]): this {
    return super.setErrorHandler((error) => safeErrorResult(clientErrorStatus(error)))
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
          else {
            try {
              sendHtml(res, withBoardDisplayStyle(html, context?.basePath ?? this.basePath))
            } catch {
              sendSafeFailure(res)
            }
          }
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
