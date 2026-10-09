import { HttpStatus, Injectable } from '@nestjs/common'

import {
  ACCESS_API_RESPONSE_BYTES,
  type MemberAccess,
  RoleDefinitionErrorCode,
  serializedJsonBytes,
} from '@amcore/shared'

import { AppException, ForbiddenException } from '../../../common/exceptions'
import { PrismaService } from '../../../prisma'
import { CapabilityRegistry } from '../capability-registry.service'

import { explainAccess } from './access-evaluator'
import { loadAccess } from './access-loader'

const unavailable = (): AppException =>
  new AppException(
    'Member access cannot be explained',
    HttpStatus.SERVICE_UNAVAILABLE,
    RoleDefinitionErrorCode.ROLE_ACCESS_UNAVAILABLE
  )

/**
 * Explains a member's effective access in the current organization. Read-only: one repeatable-read
 * snapshot, no writes, no audit. Anything that is not a deliberate 4xx (an invalid stored rule, a
 * limit, an unexpected failure) is `ROLE_ACCESS_UNAVAILABLE`; the service never answers from a
 * partial or unverifiable policy.
 */
@Injectable()
export class MemberAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CapabilityRegistry
  ) {}

  async explain(
    orgId: string,
    userId: string,
    actorOrganizationId: string | undefined
  ): Promise<MemberAccess> {
    if (orgId !== actorOrganizationId) throw new ForbiddenException()
    try {
      const result = await this.prisma.$transaction(
        async (tx) =>
          explainAccess({ ...(await loadAccess(tx, orgId, userId)), registry: this.registry }),
        { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 4000 }
      )
      if (serializedJsonBytes(result) > ACCESS_API_RESPONSE_BYTES) throw unavailable()
      return result
    } catch (error) {
      if (error instanceof AppException || error instanceof ForbiddenException) throw error
      throw unavailable()
    }
  }
}
