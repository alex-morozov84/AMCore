import { subject } from '@casl/ability'
import { Injectable } from '@nestjs/common'

import { Action, Subject } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'

import { OWN_USER_READ_FIELDS, OWN_USER_UPDATE_FIELDS } from './casl/org-role-defaults'
import { normalizeOwnerPermissions } from './casl/permission-normalization'
import { createPrismaAbility } from './casl/prisma-ability'
import { memberPermissionSnapshot } from './member-permission-snapshot'

import type { Prisma } from '@/generated/prisma/client'

/** Primary, transaction-aware domain rights. No HTTP admission or privileged-role synthesis. */
@Injectable()
export class DomainAuthorizationService {
  async assert(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    organizationId: string | null,
    action: Action,
    subjectName: Subject,
    record: Record<string, unknown>,
    fields: readonly string[]
  ): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: ownerUserId }, select: { id: true } })
    if (!user) throw new ForbiddenException()
    const identity = { sub: ownerUserId, ...(organizationId ? { organizationId } : {}) }
    let permissions
    if (organizationId) {
      const snapshot = await memberPermissionSnapshot(tx, ownerUserId, organizationId)
      if (!snapshot.memberId || snapshot.unsafe.length) throw new ForbiddenException()
      permissions = snapshot.permissions
    } else {
      permissions = [
        {
          id: 'synthetic-self-read',
          action: Action.Read,
          subject: Subject.User,
          conditions: { id: ownerUserId },
          fields: [...OWN_USER_READ_FIELDS],
          inverted: false,
        },
        {
          id: 'synthetic-self-update',
          action: Action.Update,
          subject: Subject.User,
          conditions: { id: ownerUserId },
          fields: [...OWN_USER_UPDATE_FIELDS],
          inverted: false,
        },
      ]
    }
    const normalized = normalizeOwnerPermissions(permissions, identity)
    const ability = createPrismaAbility(
      normalized.map((permission) => ({
        action: permission.action,
        subject: permission.subject,
        inverted: permission.inverted,
        ...(permission.conditions !== null ? { conditions: permission.conditions } : {}),
        ...(permission.fields.length ? { fields: permission.fields } : {}),
      }))
    )
    const target = subject(subjectName, record)
    if (
      !ability.can(action, target) ||
      fields.some((field) => !ability.can(action, target, field))
    ) {
      throw new ForbiddenException()
    }
  }
}
