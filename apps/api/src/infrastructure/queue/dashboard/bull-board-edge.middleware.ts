import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { applyBoardHeaders } from './bull-board-boundary.middleware'
import { safeErrorResult } from './bull-board-errors'

/** CORS answers the board never gives: it is same-origin only (`Cross-Origin-Resource-Policy`). */
const CORS_HEADERS = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
] as const

/**
 * The outermost guard of the board mount, registered BEFORE the global body parser, Helmet and CORS.
 *
 * Everything that answers a request for the mount before the board's own chain would otherwise
 * escape it: a body-parser failure, a CORS preflight, an admission refusal. This guard makes the
 * board's contract hold for all of them:
 *
 * - only `GET`/`HEAD` get any further; every other method (including a CORS preflight) is a `405`
 *   with `Allow: GET, HEAD` before any parser or CORS handler sees it;
 * - a path that is not valid percent-encoding is a `400` with the board's fixed error body;
 * - a `GET`/`HEAD` never has a body the board reads, so its body headers are dropped and the global
 *   parsers skip it (no parser error, no echo of request content);
 * - the board's own security headers (CSP, cache, referrer, CORP, framing) are applied again at the
 *   moment the response head is written, so they replace Helmet's and also cover refusals and error
 *   responses, and any CORS headers are removed from the board's responses. The one cache choice the
 *   board makes itself survives: a successful static file marked `private, no-cache` by the boundary
 *   keeps it; every other answer is `private, no-store`.
 */
export function createBullBoardEdgeGuard(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const writeHead = res.writeHead as (...args: unknown[]) => Response
    res.writeHead = function (this: Response, ...args: unknown[]): Response {
      const status = typeof args[0] === 'number' ? args[0] : res.statusCode
      const revalidate = status < 400 && res.getHeader('Cache-Control') === 'private, no-cache'
      applyBoardHeaders(res, revalidate)
      for (const name of CORS_HEADERS) res.removeHeader(name)
      return writeHead.apply(this, args)
    } as Response['writeHead']

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').end()
      return
    }
    // A path that cannot be decoded would fail inside the routing layer, which answers with the general
    // error body naming the request; refuse it here, with the board's own.
    try {
      decodeURIComponent(req.path)
    } catch {
      res.status(400).json(safeErrorResult(400).body)
      return
    }
    delete req.headers['content-type']
    delete req.headers['content-encoding']
    next()
  }
}
