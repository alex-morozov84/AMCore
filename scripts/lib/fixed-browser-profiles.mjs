import { productAdminE2ePlans } from '../product-admin-e2e-plan.mjs'

const builtIn = {
  host: { lane: 'console-real-stack' },
  'setup-cli': { lane: 'real-stack', fixture: 'organization-setup' },
  'setup-console': { lane: 'console-real-stack', fixture: 'organization-setup' },
}

export function fixedBrowserProfile(lane, staffPlans = productAdminE2ePlans) {
  return builtIn[lane] ?? staffPlans[lane]
}
