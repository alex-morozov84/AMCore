'use client'

import { createContext, type ReactNode, useContext } from 'react'

type RoleHref = (roleId: string) => string

const RoleLinks = createContext<RoleHref | undefined>(undefined)

/**
 * Where a role's own page lives. A page provides it once; role badges, role pickers and role lists
 * anywhere below read it, so the address is not threaded through every component in between.
 * Without a provider nothing links to a role, so the same components work in a headless setup.
 */
export function RoleLinkProvider({
  roleHref,
  children,
}: {
  roleHref: RoleHref | undefined
  children: ReactNode
}) {
  return <RoleLinks.Provider value={roleHref}>{children}</RoleLinks.Provider>
}

/** The address of a role page, or `undefined` when no page provides one. */
export function useRoleHref(): RoleHref | undefined {
  return useContext(RoleLinks)
}

/** A role page sits under the roles tab: `<tab>/<roleId>`. Serializable input, function output. */
export function roleHrefUnder(rolesTabHref: string | undefined): RoleHref | undefined {
  return rolesTabHref ? (roleId) => `${rolesTabHref}/${encodeURIComponent(roleId)}` : undefined
}
