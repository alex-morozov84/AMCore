import type { RequestPrincipal } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'

export interface ApiKeyEvidence {
  readonly keyId: string
  readonly ownerId: string
  readonly organizationId: string
  readonly scopes: readonly string[]
}
const authenticatedKeys = new WeakMap<object, ApiKeyEvidence>()

/** Called only after cryptographic authentication; never read from HTTP input. */
export function registerApiKeyAdmission(
  request: object,
  keyId: string,
  actor: RequestPrincipal
): void {
  if (actor.type !== 'api_key' || !actor.organizationId) throw new ForbiddenException()
  authenticatedKeys.set(
    request,
    Object.freeze({
      keyId,
      ownerId: actor.sub,
      organizationId: actor.organizationId,
      scopes: Object.freeze([...(actor.scopes ?? [])]),
    })
  )
}

export function apiKeyAdmission(request: object, actor: RequestPrincipal): ApiKeyEvidence {
  const evidence = authenticatedKeys.get(request)
  if (
    !evidence ||
    actor.type !== 'api_key' ||
    evidence.ownerId !== actor.sub ||
    evidence.organizationId !== actor.organizationId ||
    JSON.stringify(evidence.scopes) !== JSON.stringify(actor.scopes ?? [])
  )
    throw new ForbiddenException()
  return evidence
}
