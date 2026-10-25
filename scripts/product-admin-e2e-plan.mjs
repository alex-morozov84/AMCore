import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const productAdminE2ePlans = {
  'staff-oauth': {
    lane: 'product-admin-real-stack',
    fixture: 'product-admin-oauth',
    files: [
      'product-admin-oauth.spec.ts',
      'product-admin-oauth-get.spec.ts',
      'product-admin-oauth-surfaces.spec.ts',
      'product-admin-review-c2.spec.ts',
      'product-admin-denied-loss.spec.ts',
    ],
  },
  // AMCORE_CONSOLE_STAFF_CI_START
  'staff-host': {
    lane: 'product-admin-real-stack',
    fixture: 'product-admin-three-host',
    files: ['product-admin-host.spec.ts'],
  },
  'staff-console-path': {
    lane: 'product-admin-real-stack',
    fixture: 'product-admin-console-path',
    files: ['product-admin-console-path.spec.ts'],
  },
  'staff-invitation': {
    lane: 'product-admin-real-stack',
    fixture: 'product-admin-closed-signup',
    files: ['product-admin-invitation.spec.ts'],
  },
  'staff-path-oauth': {
    lane: 'real-stack',
    fixture: 'product-admin-oauth-path',
    files: ['product-admin-oauth-path.spec.ts'],
  },
  'support-mail-path': {
    lane: 'product-admin-real-stack',
    fixture: 'support-mail-path',
    files: ['console-support-mail.spec.ts'],
  },
  'support-mail-host': {
    lane: 'product-admin-real-stack',
    fixture: 'support-mail-host',
    files: ['console-support-mail.spec.ts'],
  },
  // AMCORE_CONSOLE_STAFF_CI_END
}

export function productAdminCiLanes(root) {
  for (const plan of Object.values(productAdminE2ePlans)) {
    for (const file of plan.files) {
      const directory = plan.lane === 'real-stack' ? 'real-stack' : 'product-admin-real-stack'
      if (!existsSync(join(root, 'apps/web/e2e', directory, file)))
        throw new Error(`Missing declared staff E2E: ${directory}/${file}`)
    }
  }
  return Object.keys(productAdminE2ePlans)
}
