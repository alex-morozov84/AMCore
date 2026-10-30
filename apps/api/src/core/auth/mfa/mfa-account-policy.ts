import { type SystemRole as Role, SystemRole } from '@amcore/shared'

export interface AccountProtection {
  systemRole: Role
  required: boolean
  emergencyRequired: boolean
  factorVersion: number | null
}

/** Enrollment policy may later expand independently from login protection. */
export function enrollmentEligible(account: AccountProtection): boolean {
  return (
    account.systemRole === SystemRole.SuperAdmin ||
    account.required ||
    account.emergencyRequired ||
    account.factorVersion !== null
  )
}

/** Bound/recovery-required accounts cannot fall into the ordinary-client exception. */
export function accountRequiresMfa(account: AccountProtection): boolean {
  return (
    account.systemRole === SystemRole.SuperAdmin ||
    account.required ||
    account.emergencyRequired ||
    account.factorVersion !== null
  )
}
