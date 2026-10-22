import { productAdminPath } from '@amcore/shared'

import type { AuthActionBase } from '@/shared/api/auth-api'

/** Serializable product placement; rendering and the headless model do not own a downstream design. */
export interface InvitationPlacement {
  leaveHref: string
  organizationHref: string
  actionBase?: AuthActionBase
  verifyHref?: string
}
export const invitationPlacement: InvitationPlacement = {
  leaveHref: '/organizations',
  organizationHref: '/organizations/:id',
}
export function invitationOrganizationHref(placement: InvitationPlacement, id: string) {
  return placement.organizationHref.replace(':id', encodeURIComponent(id))
}

export const adminInvitationPlacement: InvitationPlacement = {
  leaveHref: productAdminPath('/organizations'),
  organizationHref: `${productAdminPath('/organizations')}/:id`,
  actionBase: '/product-admin/auth',
  verifyHref: productAdminPath('/verify-email'),
}
