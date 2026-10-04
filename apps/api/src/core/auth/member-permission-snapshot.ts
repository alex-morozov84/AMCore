import type { Permission, Prisma, Role } from '@/generated/prisma/client'

/** Same safe-role filtering and complete payload for cache fills and locked writes. */
export async function memberPermissionSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string
): Promise<{
  memberId: string | undefined
  permissions: Permission[]
  unsafe: Array<{ role: Pick<Role, 'id' | 'isSystem' | 'organizationId'> }>
}> {
  const member = await tx.orgMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  })
  const safe = (role: { isSystem: boolean; organizationId: string | null }): boolean =>
    (role.isSystem && role.organizationId === null) || role.organizationId === organizationId
  const unsafe = member?.roles.filter(({ role }) => !safe(role)) ?? []
  const permissions = new Map<
    string,
    NonNullable<typeof member>['roles'][number]['role']['permissions'][number]['permission']
  >()
  for (const { role } of member?.roles ?? []) {
    if (!safe(role)) continue
    for (const { permission } of role.permissions) {
      // The same permission can be linked through several safe roles.
      if (!permissions.has(permission.id)) permissions.set(permission.id, permission)
    }
  }
  return { memberId: member?.id, permissions: [...permissions.values()], unsafe }
}
