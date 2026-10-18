import { Injectable } from '@nestjs/common'

import type { MemberKeyCommand, MemberKeyResult } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { AuditActorType, AuditTargetType } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'
import { ApiKeyRevocationService } from '../../api-keys/api-key-revocation.service.js'
import { AuditLogService } from '../../audit/index.js'
import { lockOrganization } from '../organization-mutation-lock.js'

import type { MemberKeyActor } from './member-key-actor.js'
import { authorizeMemberKeys, lockKeyActor } from './member-key-authority.js'
import {
  MEMBER_KEY_TRANSACTION,
  memberKeyTimeouts,
  memberKeyWriteFailure,
} from './member-key-transaction.js'

@Injectable()
export class MemberKeyCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revoke: ApiKeyRevocationService,
    private readonly audit: AuditLogService
  ) {}

  async execute(
    orgId: string,
    userId: string,
    input: MemberKeyCommand,
    actor: MemberKeyActor,
    keyId?: string
  ): Promise<MemberKeyResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await memberKeyTimeouts(tx)
        const role = await lockKeyActor(tx, actor)
        await lockOrganization(tx, orgId)
        await authorizeMemberKeys(tx, orgId, actor, role)
        const member = await tx.orgMember.findUnique({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          select: { id: true },
        })
        if (!member) throw new AppException('Member unavailable', 404, 'MEMBER_UNAVAILABLE')
        if (member.id !== input.expectedMemberId)
          throw new AppException('Member changed', 409, 'MEMBER_API_KEYS_CONFLICT')
        const counts = await this.revoke.revokeMember(
          tx,
          orgId,
          userId,
          actor.principal.sub,
          'organization_admin_revoked',
          keyId
        )
        await this.audit.record(
          {
            action: 'organization.api_keys.revocation_requested',
            actorId: actor.principal.sub,
            actorType: AuditActorType.USER,
            organizationId: orgId,
            targetId: userId,
            targetType: AuditTargetType.USER,
            metadata: {
              operation: keyId ? 'single' : 'all',
              memberId: member.id,
              ...counts,
              reason: 'organization_admin_revoked',
            },
          },
          { tx }
        )
        return {
          organizationId: orgId,
          userId,
          memberId: member.id,
          ...(keyId && { keyId }),
          ...counts,
        }
      }, MEMBER_KEY_TRANSACTION)
    } catch (error) {
      return memberKeyWriteFailure(error)
    }
  }
}
