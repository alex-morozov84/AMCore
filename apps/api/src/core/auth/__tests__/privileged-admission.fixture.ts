import type { RequestPrincipal } from '@amcore/shared'

import {
  type PrivilegedAdmission,
  PrivilegedAdmissionService,
} from '../privileged-admission.service'
import type { PrivilegedRoleService } from '../privileged-role.service'

/** Permission-only fixtures: primary role matches credential; freshness has separate tests. */
export function admissionForTest(principal: RequestPrincipal): Promise<PrivilegedAdmission> {
  const roles = { getCurrentSystemRole: async () => principal.systemRole }
  return new PrivilegedAdmissionService(roles as unknown as PrivilegedRoleService).resolve(
    principal
  )
}
