import type { RequestPrincipal, SystemRole } from '@amcore/shared'

/** Short-lived return value passed directly from admission to privilege selection, never cached. */
export interface MfaAdmissionEvidence {
  readonly principal: RequestPrincipal
  readonly currentRole: SystemRole
}
