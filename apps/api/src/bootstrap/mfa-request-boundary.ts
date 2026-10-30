import type { INestApplication } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import { AppException } from '../common/exceptions/index.js'
import { mfaCredentialPath } from '../common/utils/mfa-credential-path.js'

export const MFA_CREDENTIAL_BODY_BYTES = 2048

/** Headers precede validation errors; credential commands accept no query credentials or selectors. */
export function configureMfaBoundary(app: INestApplication, prefix: string): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl ?? req.url
    if (!mfaCredentialPath(url, prefix)) return next()
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    if ((url.split('?')[1] ?? '').length)
      return next(
        new AppException('Credential routes require an empty query', 400, 'VALIDATION_ERROR')
      )
    return next()
  })
}
