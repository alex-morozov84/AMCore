import { SystemRole } from '@amcore/shared'

import { accountRequiresMfa, enrollmentEligible } from './mfa-account-policy.js'

const ordinary = {
  systemRole: SystemRole.User,
  required: false,
  emergencyRequired: false,
  factorVersion: null,
}
describe('Separate enrollment and account-protection policies', () => {
  it('keeps never-enrolled ordinary accounts outside initial enrollment and MFA protection', () => {
    expect(enrollmentEligible(ordinary)).toBe(false)
    expect(accountRequiresMfa(ordinary)).toBe(false)
  })
  it.each([
    { systemRole: SystemRole.SuperAdmin },
    { required: true },
    { emergencyRequired: true },
    { factorVersion: 1 },
  ])('retains protection independently of other flags %j', (change) => {
    expect(enrollmentEligible({ ...ordinary, ...change })).toBe(true)
    expect(accountRequiresMfa({ ...ordinary, ...change })).toBe(true)
  })
})
