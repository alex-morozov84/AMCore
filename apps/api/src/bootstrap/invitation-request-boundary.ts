import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'

import { AppException } from '../common/exceptions'

/** Classify for budgets only: never rewrite routing or dynamic identifiers. */
function invitationBudgetPath(url: string): string {
  const raw = url.split('?')[0] ?? ''
  return raw
    .replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16))
      return /^[A-Za-z0-9._~-]$/.test(char) ? char : encoded
    })
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

export function invitationRequestKind(url: string, prefix: string): 'personal' | 'manager' | null {
  const path = invitationBudgetPath(url)
  if (!path.toLowerCase().startsWith(prefix.toLowerCase() + '/')) return null
  const relative = path.slice(prefix.length)
  if (/^\/auth\/invites(?:\/|$)/i.test(relative)) return 'personal'
  return /^\/organizations\/[^/]+\/(?:invites|invite-operations)(?:\/|$)/i.test(relative)
    ? 'manager'
    : null
}

export function configureInvitationBoundary(app: NestExpressApplication, prefix: string): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!invitationRequestKind(req.originalUrl, prefix)) return next()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    const query = req.originalUrl.split('?')[1] ?? ''
    if (Buffer.byteLength(query) > 2048)
      return next(new AppException('Query budget exceeded', 400, 'VALIDATION_ERROR'))
    const names = [...new URLSearchParams(query).keys()]
    const path = invitationBudgetPath(req.originalUrl)
    const allowed =
      /\/organizations\/[^/]+\/invites$/i.test(path) && req.method === 'GET'
        ? ['page', 'limit', 'search', 'status']
        : /\/invites\/role-choices$/i.test(path) && req.method === 'GET'
          ? ['page', 'limit', 'search']
          : req.method === 'DELETE' && invitationRequestKind(req.originalUrl, prefix) === 'manager'
            ? ['expectedGeneration']
            : []
    if (names.some((name) => !allowed.includes(name)))
      return next(new AppException('Unknown query parameter', 400, 'VALIDATION_ERROR'))
    if (new Set(names).size !== names.length)
      return next(new AppException('Duplicate query parameter', 400, 'VALIDATION_ERROR'))
    return next()
  })
}
export function invitationJsonLimit(url: string, prefix: string): number | null {
  if (!invitationRequestKind(url, prefix)) return null
  const path = invitationBudgetPath(url)
  return /\/auth\/invites\/(?:accept|continuations)$/i.test(path) ? 2048 : 16384
}
