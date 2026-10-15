import type { RequestPrincipal } from '@amcore/shared'

import {
  type PrivilegedAdmission,
  PrivilegedAdmissionService,
} from '../privileged-admission.service.js'
import type { PrivilegedRoleService } from '../privileged-role.service.js'

/** Permission-only fixtures: primary role matches credential; freshness has separate tests. */
export function admissionForTest(principal: RequestPrincipal): Promise<PrivilegedAdmission> {
  const roles = { getCurrentSystemRole: async () => principal.systemRole }
  return new PrivilegedAdmissionService(roles as unknown as PrivilegedRoleService).resolve(
    principal
  )
}
