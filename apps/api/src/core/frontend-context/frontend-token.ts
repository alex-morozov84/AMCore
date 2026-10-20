import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'

import type { BrowserFrontendContext } from './frontend-placement.js'

export function frontendTokenData(context?: BrowserFrontendContext): {
  frontendDestination?: 'site' | 'admin'
  placementFingerprint?: string
} {
  return context
    ? {
        frontendDestination: context.frontend,
        placementFingerprint: context.placementFingerprint,
      }
    : {}
}

/** Native token consumers retain the API contract; browser publication is pinned. */
export function assertTokenFrontend(
  record: { frontendDestination?: string; placementFingerprint?: string | null },
  context?: BrowserFrontendContext
): void {
  if (!context) return
  if (
    (record.frontendDestination ?? 'site') !== context.frontend ||
    (record.placementFingerprint && record.placementFingerprint !== context.placementFingerprint)
  )
    throw new AppException(
      'Invalid or expired token',
      HttpStatus.UNAUTHORIZED,
      AuthErrorCode.TOKEN_INVALID
    )
}
