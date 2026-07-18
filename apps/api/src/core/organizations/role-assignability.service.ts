import { Injectable } from '@nestjs/common'

import { ForbiddenException } from '../../common/exceptions'

import type { Prisma } from '@/generated/prisma/client'

type PrismaTx = Prisma.TransactionClient

/**
 * OA-05 invariant — checks that a roleId is allowed to be attached to
 * a member of `orgId`. Allowed values:
 *   - a system role (`isSystem === true && organizationId === null`), or
 *   - a custom role owned by the same organization
 *     (`organizationId === orgId`).
 *
 * Anything else — a custom role from a foreign organization, a row
 * that doesn't exist, or a system row with the wrong shape — is
 * rejected with a uniform 403. The uniform response is deliberate:
 * distinguishing "role belongs to org B" from "role does not exist"
 * would let an attacker enumerate roleIds across orgs by status code
 * or timing.
 *
 * Extracted from `MemberService.assertRoleAssignable` (Stage 4 / OA-05)
 * for reuse by `InviteService.acceptInvite`, which performs the same
 * check at accept time so a role deleted between invite creation and
 * accept cannot smuggle a foreign-org role through the invite handle.
 *
 * Must be called inside the same transaction that performs the
 * subsequent membership / role-link write, otherwise the role's
 * `organizationId` could change between the check and the write.
 */
@Injectable()
export class RoleAssignabilityService {
  async assert(roleId: string, orgId: string, tx: PrismaTx): Promise<void> {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      select: { organizationId: true, isSystem: true },
    })

    const isSystemRole = role?.isSystem === true && role.organizationId === null
    const isOwnedCustomRole = role !== null && role.organizationId === orgId

    if (!isSystemRole && !isOwnedCustomRole) {
      throw new ForbiddenException('Role is not assignable in this organization')
    }
  }
}
