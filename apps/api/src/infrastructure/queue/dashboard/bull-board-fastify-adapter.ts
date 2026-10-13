import type { AppControllerRoute, AppViewRoute, UIConfig } from '@bull-board/api/typings/app'
import { FastifyAdapter } from '@bull-board/fastify'
import type {} from '@fastify/view'
import type { Request, RequestHandler, Response } from 'express'

import type { BoardRequestLocals } from './bull-board-boundary.middleware'
import { boardCopy, boardLanguage } from './bull-board-copy'
import {
  BOARD_DISPLAY_CSS,
  FLOW_CSS,
  INFO_ASSET,
  readBoardDisplayAssets,
  withBoardDisplayStyle,
} from './bull-board-display-assets'
import { clientErrorStatus, safeErrorResult, withFinalBoundary } from './bull-board-errors'
import { withBoardReadBudget } from './bull-board-read-budget'

/** Fastify board seam: the plugin applies the closed boundary on every child route. */
export class QueueBoardFastifyAdapter extends FastifyAdapter {
  private mount = ''
  private nativeView?: AppViewRoute
  private nativeUiConfig: UIConfig = {}
  private display?: { route: string; values: ReturnType<typeof readBoardDisplayAssets> }

  constructor(private readonly admission: RequestHandler) {
    super()
  }

  override setBasePath(path: string): this {
    this.mount = path
    super.setBasePath(path)
    return this
  }

  override setStaticPath(route: string, directory: string): this {
    this.display = { route, values: readBoardDisplayAssets(directory) }
    super.setStaticPath(route, directory)
    return this
  }

  override setEntryRoute(route: AppViewRoute): this {
    this.nativeView = route
    super.setEntryRoute(route)
    return this
  }

  override setUIConfig(config: UIConfig = {}): this {
    this.nativeUiConfig = config
    super.setUIConfig(config)
    return this
  }

  override setApiRoutes(routes: AppControllerRoute[]): this {
    super.setApiRoutes(
      routes.map((route) => ({
        ...route,
        handler: withFinalBoundary(
          withBoardReadBudget(route.handler)
        ) as AppControllerRoute['handler'],
      }))
    )
    return this
  }

  override setErrorHandler(_handler: Parameters<FastifyAdapter['setErrorHandler']>[0]): this {
    return super.setErrorHandler((error) => safeErrorResult(clientErrorStatus(error)))
  }

  override registerPlugin(): ReturnType<FastifyAdapter['registerPlugin']> {
    const plugin = super.registerPlugin()
    return (instance, options, done) => {
      instance.setNotFoundHandler((_request, reply) =>
        reply.code(404).send(safeErrorResult(404).body)
      )
      instance.addHook('onSend', (request, reply, payload, done) => {
        if (
          reply.statusCode < 400 &&
          request.url.split('?')[0]?.startsWith(`${this.mount}/static/`)
        ) {
          reply.header('Cache-Control', 'private, no-cache')
          reply.raw.setHeader('Cache-Control', 'private, no-cache')
        }
        done(null, payload)
      })
      instance.addHook('onRoute', (route) => {
        route.config = { ...route.config, cors: false }
        const view = this.nativeView
        if (!view) return
        const urls = Array.isArray(view.route) ? view.route : [view.route]
        // Fastify registers the prefixed root without a slash first, then reuses its handler.
        if (!urls.some((url) => route.url === `${this.mount}${url === '/' ? '' : url}`)) return
        route.handler = async (request, reply) => {
          try {
            const context = (reply.raw as unknown as { locals?: BoardRequestLocals }).locals
              ?.boardContext
            const copy = boardCopy(context?.locale)
            const basePath = context?.basePath ?? this.mount
            const result = view.handler({
              basePath,
              uiConfig: {
                ...this.nativeUiConfig,
                boardTitle: copy.boardTitle,
                environment: { label: copy.readOnlyLabel, color: '#334155', textColor: '#f8fafc' },
                locale: { lng: boardLanguage(context?.locale) },
                ...(context
                  ? { miscLinks: [{ text: copy.backToConsole, url: context.returnHref }] }
                  : {}),
              },
            })
            const html = await reply.viewAsync(result.name, result.params)
            return reply.type('text/html').send(withBoardDisplayStyle(html, basePath))
          } catch {
            return reply.code(500).send(safeErrorResult(500).body)
          }
        }
      })
      instance.addHook('onRequest', async (request, reply) => {
        const raw = request.raw as unknown as Request
        const response = reply.raw as unknown as Response
        const url = raw.url
        const originalUrl = raw.originalUrl
        raw.originalUrl = url
        const relative = url.slice(this.mount.length)
        raw.url = relative.startsWith('/') ? relative : `/${relative}`
        try {
          await new Promise<void>((resolve, reject) => {
            const finish = (): void => {
              response.removeListener('close', finish)
              response.removeListener('finish', finish)
              reply.hijack()
              resolve()
            }
            response.once('finish', finish)
            response.once('close', finish)
            const next = (error?: unknown): void => {
              response.removeListener('finish', finish)
              response.removeListener('close', finish)
              if (error) reject(error)
              else resolve()
            }
            try {
              this.admission(raw, response, next)
            } catch (error) {
              next(error)
            }
          })
        } finally {
          raw.url = url
          raw.originalUrl = originalUrl
        }
      })
      plugin(instance, options, (error) => {
        if (error) return done(error)
        const display = this.display
        if (display) {
          instance.get(`${display.route}/${INFO_ASSET}`, (_request, reply) =>
            reply.type('application/javascript').send(display.values.readOnlyInfo)
          )
          for (const asset of display.values.assets)
            instance.get(
              `${display.route}/locales/${asset.locale}/messages.json`,
              (_request, reply) => reply.send(asset.messages)
            )
          instance.get(`${display.route}/${BOARD_DISPLAY_CSS}`, (_request, reply) =>
            reply.type('text/css').send(FLOW_CSS)
          )
        }
        done()
      })
    }
  }
}
