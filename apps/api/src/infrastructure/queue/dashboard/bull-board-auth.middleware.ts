import type { NextFunction, Request, RequestHandler, Response } from 'express'

import type { BullBoardAuthService } from './bull-board-auth.service'

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

/**
 * Auth middleware for the mounted Bull Board router (EQS-01).
 *
 * Built as a closure over the injected verifier so it can run before the
 * Bull Board router via `BullBoardModule.forRootAsync({ useFactory })` without
 * importing `AuthModule` (cycle avoidance).
 *
 * Policy:
 * - Machine credentials are rejected outright: Bull Board is a user-admin UI,
 *   not a machine-admin API. An `Authorization` header carrying an API key
 *   (`amcore_` prefix — the project's single API-key transport, see
 *   `api-keys/guards/api-key.guard.ts`) or any `x-api-key` header → 401. The
 *   `x-api-key` check is belt-and-suspenders against a future alias.
 * - No `refresh_token` cookie → 401.
 * - Valid session but not `SUPER_ADMIN` → 403; otherwise `next()`.
 *
 * Denials end the response with a bare status (no body): the dashboard UI and
 * its assets must reveal nothing to an unauthorized caller.
 */
export function createBullBoardAuthMiddleware(auth: BullBoardAuthService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization
    if (typeof authHeader === 'string' && authHeader.includes('amcore_')) {
      res.status(401).end()
      return
    }

    if (req.headers['x-api-key'] !== undefined) {
      res.status(401).end()
      return
    }

    const refreshToken = readRefreshTokenCookie(req)
    if (!refreshToken) {
      res.status(401).end()
      return
    }

    auth
      .verifyAccess(refreshToken)
      .then((access) => {
        if (access === 'authorized') {
          next()
        } else {
          res.status(access === 'forbidden' ? 403 : 401).end()
        }
      })
      .catch(() => {
        res.status(401).end()
      })
  }
}
