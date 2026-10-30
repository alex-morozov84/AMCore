import { Injectable } from '@nestjs/common'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'

import { takeJwtPrimaryProjection } from './jwt-primary-admission.js'
import type { MfaAdmissionEvidence } from './mfa-admission-evidence.js'
import { requireMfaAdmission } from './mfa-admission-result.js'
import { MfaAuthorityReader } from './mfa-authority-reader.service.js'

/** Runs after credential selection and before privileges/ability; a denial cannot select another credential. */
@Injectable()
export class MfaJwtAdmissionService {
  constructor(private readonly authority: MfaAuthorityReader) {}

  async assert(
    request: object,
    principal: RequestPrincipal
  ): Promise<MfaAdmissionEvidence | undefined> {
    if (principal.type !== 'jwt') return
    const browser = browserSessionContext(request)
    if (browser && !browser.binding) throw this.changed()
    const claims = { ...principal, email: principal.email ?? '' }
    const projection = takeJwtPrimaryProjection(request, principal)
    const inspected = projection
      ? {
          admission: this.authority.admitProjection(projection, claims, browser?.binding ?? null),
          currentRole: projection.user.systemRole,
        }
      : await this.authority.inspectForRuntime(claims, browser?.binding ?? null)
    const result = inspected.admission
    if (
      (browser || principal.browserBound) &&
      result.kind === 'denied' &&
      result.reason !== 'enforcement_unavailable'
    )
      throw this.changed()
    requireMfaAdmission(result)
    if (!inspected.currentRole) throw this.changed()
    return { principal, currentRole: inspected.currentRole }
  }

  private changed(): AppException {
    return new AppException(
      'Browser session authority changed',
      401,
      AuthErrorCode.AUTH_CONTEXT_CHANGED
    )
  }
}
