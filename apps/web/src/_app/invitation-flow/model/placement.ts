/** Serializable product placement; rendering and the headless model do not own a downstream design. */
export interface InvitationPlacement {
  leaveHref: string
  organizationHref: string
}
export const invitationPlacement: InvitationPlacement = {
  leaveHref: '/organizations',
  organizationHref: '/organizations/:id',
}
export function invitationOrganizationHref(placement: InvitationPlacement, id: string) {
  return placement.organizationHref.replace(':id', encodeURIComponent(id))
}
