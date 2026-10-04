import type { NextFunction, Request, RequestHandler, Response } from 'express'

import {
  BULL_BOARD_CONTEXT_HEADER,
  BULL_BOARD_CONTEXT_MAX_HEADER_LENGTH,
  parseBoardRenderContext,
} from '@amcore/shared'

import type { BullBoardAuthService } from './bull-board-auth.service'
import type { BullBoardBearerAuthService } from './bull-board-bearer-auth.service'
import type { BoardRequestLocals } from './bull-board-boundary.middleware'
import { type BoardEvent, type BoardEventSink, NOOP_BOARD_EVENTS } from './bull-board-events'

/**
 * Read the `refresh_token` cookie straight from the raw `Cookie` header.
 *
 * Bull Board is mounted as Express middleware by `@bull-board/nestjs`; the
 * ordering of that router relative to the global `cookie-parser` is not
 * guaranteed, so we parse the header ourselves instead of trusting
 * `req.cookies`. Refresh tokens are hex (`randomBytes(32).toString('hex')`),
 * so no URL-decoding is required.
 */
function readRefreshTokenCookie(req: Request): string | null {
  const header = req.headers.cookie
  if (!header) return null

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === 'refresh_token') {
      return part.slice(eq + 1).trim() || null
    }
  }
  return null
}

type DenialReason = Extract<BoardEvent, { event: 'bull_board.access_denied' }>['reason']

/**
 * The render context the Console BFF sends with a bearer request: `base64url(JSON)` of the strict
 * context schema, or `null` when it is absent. `'invalid'` for anything else. Presentation metadata
 * only: it carries no credential and nothing in it is read as a role or an organization.
 */
function readRenderContext(req: Request): BoardRequestLocals['boardContext'] | null | 'invalid' {
  const raw = req.headers[BULL_BOARD_CONTEXT_HEADER]
  if (raw === undefined) return null
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > BULL_BOARD_CONTEXT_MAX_HEADER_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    return 'invalid'
  }
  try {
    return (
      parseBoardRenderContext(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))) ??
      'invalid'
    )
  } catch {
    return 'invalid'
  }
}

/**
 * Admission middleware for the mounted Bull Board router (EQS-01, Console access).
 *
 * Two ways in, never mixed. If the request has ANY `Authorization` header it is judged only as a
 * bearer request — an invalid bearer is a 401 even when a valid cookie is also present, so a request
 * can never be admitted by whichever credential happens to be better. Without `Authorization`, the
 * browser `refresh_token` cookie is judged (direct access to the API, no Console).
 *
 * - Machine credentials are rejected outright: the board is a user UI, not a machine API. An
 *   `Authorization` header carrying an API key (`amcore_` prefix) or any `x-api-key` header → 401.
 * - Bearer (the Console BFF): a live SUPER_ADMIN access token (`BullBoardBearerAuthService`) — 401
 *   invalid/expired/unknown user, 403 not SUPER_ADMIN (claim or current role), 503 could not verify.
 *   The optional render context header is honoured only here, and an invalid one is a 400.
 * - Cookie: a session of a SUPER_ADMIN user (`BullBoardAuthService`), no render context.
 *
 * Built as a closure over the injected verifiers so it can run before the Bull Board router via
 * `BullBoardModule.forRootAsync({ useFactory })` without importing `AuthModule` (cycle avoidance).
 * Denials end the response with a bare status: the board and its assets reveal nothing to an
 * unauthorized caller.
 */
export function createBullBoardAuthMiddleware(
  cookieAuth: BullBoardAuthService,
  bearerAuth: Pick<BullBoardBearerAuthService, 'verify'>,
  events: BoardEventSink = NOOP_BOARD_EVENTS
): RequestHandler {
  const deny = (res: Response, status: 400 | 401 | 403 | 503, reason: DenialReason): void => {
    events({ event: 'bull_board.access_denied', reason })
    res.status(status).end()
  }

  const admitBearer = (req: Request, res: Response, next: NextFunction, header: string): void => {
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
    if (!token) {
      deny(res, 401, 'unauthenticated')
      return
    }
    bearerAuth
      .verify(token)
      .then((access) => {
        if (access.kind !== 'authorized') {
          const outcome = {
            unauthenticated: [401, 'unauthenticated'],
            forbidden: [403, 'forbidden'],
            unavailable: [503, 'unavailable'],
          } as const
          const [status, reason] = outcome[access.kind]
          deny(res, status, reason)
          return
        }
        const context = readRenderContext(req)
        if (context === 'invalid') {
          deny(res, 400, 'invalid_context')
          return
        }
        const locals = res.locals as BoardRequestLocals
        locals.boardCredential = 'bearer'
        locals.boardActorId = access.userId
        if (context) locals.boardContext = context
        next()
      })
      .catch(() => deny(res, 503, 'unavailable'))
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    // The render context is never accepted from a cookie request: drop it before anything reads it.
    const authHeader = req.headers.authorization
    if (authHeader === undefined) delete req.headers[BULL_BOARD_CONTEXT_HEADER]

    if (typeof authHeader === 'string' && authHeader.includes('amcore_')) {
      deny(res, 401, 'api_key')
      return
    }
    if (req.headers['x-api-key'] !== undefined) {
      deny(res, 401, 'api_key')
      return
    }
    if (authHeader !== undefined) {
      admitBearer(req, res, next, typeof authHeader === 'string' ? authHeader : '')
      return
    }

    const refreshToken = readRefreshTokenCookie(req)
    if (!refreshToken) {
      deny(res, 401, 'unauthenticated')
      return
    }

    cookieAuth
      .verifyAccess(refreshToken)
      .then((access) => {
        if (access === 'authorized') {
          ;(res.locals as BoardRequestLocals).boardCredential = 'cookie'
          next()
        } else if (access === 'forbidden') {
          deny(res, 403, 'forbidden')
        } else {
          deny(res, 401, 'unauthenticated')
        }
      })
      .catch(() => deny(res, 401, 'unavailable'))
  }
}
