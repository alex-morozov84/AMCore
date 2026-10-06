import type { Prisma } from '@/generated/prisma/client'

/** A role can be assigned only within its owning organization or as a system template. */
export function isRoleAssignable(
  role: { isSystem: boolean; organizationId: string | null } | null | undefined,
  organizationId: string
): boolean {
  return (
    !!role &&
    (role.organizationId === organizationId || (role.isSystem && role.organizationId === null))
  )
}

export function assignableRolesWhere(organizationId: string): Prisma.RoleWhereInput {
  return { OR: [{ isSystem: true, organizationId: null }, { organizationId }] }
}
