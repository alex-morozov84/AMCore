import { productAdminPath } from '@amcore/shared'

import { invitationFlowChanged } from './invitation-flow-authority'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

export function invitationPagePath(path: string, context?: ProductWebContext): string {
  if (context?.frontend !== 'admin') return path
  const index = path.indexOf('?')
  const pathname = index < 0 ? path : path.slice(0, index)
  return productAdminPath(`/${pathname.replace(/^\//, '')}`) + (index < 0 ? '' : path.slice(index))
}

export function invitationNamespace(kind: string, context?: ProductWebContext): string {
  return `web:invitation:${kind}:${context?.frontend === 'admin' ? 'v2' : 'v1'}`
}

export function invitationSurfaceData(context?: ProductWebContext) {
  if (context?.audience === 'console') throw invitationFlowChanged()
  return context?.frontend === 'admin'
    ? {
        frontend: 'admin' as const,
        audience: context.audience,
        placementFingerprint: context.placementFingerprint,
      }
    : {}
}

export function assertInvitationSurface(
  record: { frontend?: string; audience?: string; placementFingerprint?: string },
  context?: ProductWebContext
): void {
  if (context?.frontend === 'admin') {
    if (
      record.frontend !== 'admin' ||
      record.audience !== context.audience ||
      record.placementFingerprint !== context.placementFingerprint
    )
      throw invitationFlowChanged()
  } else if (
    record.frontend !== undefined ||
    record.audience !== undefined ||
    record.placementFingerprint !== undefined
  ) {
    throw invitationFlowChanged()
  }
}
