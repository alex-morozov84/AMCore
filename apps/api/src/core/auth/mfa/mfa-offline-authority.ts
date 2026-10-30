import { ForbiddenException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'

/** Runtime table DML is insufficient. This checks the actual connected role, not an environment claim. */
export async function requireOfflineMfaAuthority(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>
): Promise<string> {
  const [role] = await db.$queryRaw<{ role: string; allowed: boolean }[]>`
    SELECT current_user::text AS role,
      (r.rolsuper OR n.nspowner = r.oid OR pg_has_role(current_user, n.nspowner, 'MEMBER')) AS allowed
    FROM pg_roles r JOIN pg_namespace n ON n.nspname = 'core'
    WHERE r.rolname = current_user`
  if (!role?.allowed)
    throw new ForbiddenException('Offline MFA recovery requires database owner authority')
  return role.role
}
