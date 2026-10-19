import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { types } from 'node:util'

import { HttpException } from '@nestjs/common'
import { FastifyAdapter as NestFastifyAdapter } from '@nestjs/platform-fastify'
import type { Response } from 'express'

import { PayloadTooLargeException } from '../common/exceptions/domain/index.js'
import { configureFastifyIdempotency } from '../infrastructure/idempotency/fastify-idempotency-response.js'
import { applyBoardHeaders } from '../infrastructure/queue/dashboard/bull-board-boundary.middleware.js'
import { safeErrorResult } from '../infrastructure/queue/dashboard/bull-board-errors.js'

// The class is deliberately named `FastifyAdapter`: nestjs-cls picks the middleware mount point
// by `constructor.name === 'FastifyAdapter'`. Any other name makes it treat the adapter as
// Express and mount the correlation-ID middleware on `/` only, so no real request got an ID.
class FastifyAdapter extends NestFastifyAdapter<Server> {
  override mapException(error: unknown): unknown {
    if (
      error instanceof Error &&
      (error as { code?: unknown }).code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    )
      return new PayloadTooLargeException()
    if (
      types.isNativeError(error) &&
      (error as Error & { code?: string }).code === 'FST_CP_ERR_INVALID_CONTENT'
    )
      return new HttpException('Invalid compressed body', 400)
    return super.mapException(error)
  }
}

/** Native routing errors happen before middleware: preserve the board's closed edge response. */
export function createHttpAdapter(
  mount = '/api/v1/admin/queues',
  trustProxy: boolean | number | string = false,
  boardMounted = false
): NestFastifyAdapter<Server> {
  const adapter = new FastifyAdapter({
    trustProxy:
      typeof trustProxy === 'number'
        ? (_address: string, hop: number) => hop < trustProxy
        : trustProxy,
    routerOptions: {
      ignoreTrailingSlash: true,
      caseSensitive: false,
      onBadUrl(path: string, req: IncomingMessage, res: ServerResponse) {
        const url = (req.url ?? '').toLowerCase()
        const classificationMount = mount.toLowerCase()
        const board =
          boardMounted &&
          (url === classificationMount ||
            url.startsWith(`${classificationMount}/`) ||
            url.startsWith(`${classificationMount}?`))
        if (board) {
          applyBoardHeaders(res as unknown as Response)
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET, HEAD')
            res.end()
            return
          }
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(safeErrorResult(400).body))
          return
        }
        // Preserve Fastify5.12.5's default outside this board-owned boundary.
        const body = JSON.stringify({
          error: 'Bad Request',
          code: 'FST_ERR_BAD_URL',
          message: `'${path}' is not a valid url component`,
          statusCode: 400,
        })
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        })
        res.end(body)
      },
    },
  })
  configureFastifyIdempotency(adapter.getInstance())
  return adapter
}
