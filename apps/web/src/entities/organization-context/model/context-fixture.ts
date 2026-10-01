import type { OrganizationContextResponse } from '@amcore/shared'

/** Story and test transport fixture; server responses are still parsed at the boundary. */
export const contextAffordances = {
  actorAffordances: {
    'teamAccess.manage': 'allowed',
    'organization.read': 'allowed',
    'organization.update': 'recordRequired',
    'organization.delete': 'recordRequired',
  },
  recordAffordances: {
    'organization.read': { allowed: true, fields: {} },
    'organization.update': { allowed: false, fields: { name: false, slug: false } },
    'organization.delete': { allowed: false, fields: {} },
  },
} satisfies Pick<OrganizationContextResponse, 'actorAffordances' | 'recordAffordances'>
