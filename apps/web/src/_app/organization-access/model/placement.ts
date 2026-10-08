export interface OrganizationAccessPlacement {
  readonly organizationsPath: string
  readonly homeHref: string
}

/** Application-owned destinations: change once, then wire matching physical routes. */
export const organizationAccessPlacement: OrganizationAccessPlacement = Object.freeze(
  normalizePlacement({
    organizationsPath: '/organizations',
    homeHref: '/',
  })
)

function placementPath(value: string, field: string, allowRoot: boolean) {
  if (typeof value !== 'string') throw new Error(`Invalid organization placement ${field}`)
  const path = value.replace(/\/+$/, '') || '/'
  if (
    (path === '/'
      ? !allowRoot || value !== '/'
      : !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) ||
    /\/\//.test(value)
  ) {
    throw new Error(`Invalid organization placement ${field}: use a locale-neutral same-host path`)
  }
  return path
}

function normalizePlacement(placement: OrganizationAccessPlacement): OrganizationAccessPlacement {
  return {
    organizationsPath: placementPath(placement.organizationsPath, 'organizationsPath', false),
    homeHref: placementPath(placement.homeHref, 'homeHref', true),
  }
}

/** Ordinary hierarchical routes only; custom destinations use the explicit page API. */
export function organizationAccessHrefs(placement: OrganizationAccessPlacement) {
  const path = placementPath(placement.organizationsPath, 'organizationsPath', false)
  const homeHref = placementPath(placement.homeHref, 'homeHref', true)
  return {
    menuHref: path,
    listHref: `${path}?view=list`,
    invitationsHref: (id: string) => `${path}/${encodeURIComponent(id)}/invites`,
    membersHref: (id: string) => `${path}/${encodeURIComponent(id)}/members`,
    rolesHref: (id: string) => `${path}/${encodeURIComponent(id)}/roles`,
    roleHref: (id: string, roleId: string) =>
      `${path}/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}`,
    contextHref: (id: string) => `${path}/${encodeURIComponent(id)}`,
    pageHref: (page: number) => `${path}?view=list&page=${page}`,
    homeHref,
  }
}
