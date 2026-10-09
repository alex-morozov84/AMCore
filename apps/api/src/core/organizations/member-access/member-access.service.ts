import { HttpStatus, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  ACCESS_API_RESPONSE_BYTES,
  type MemberAccess,
  RoleDefinitionErrorCode,
  serializedJsonBytes,
} from '@amcore/shared'

import { AppException, ForbiddenException } from '../../../common/exceptions'
import { PrismaService } from '../../../prisma'
import { CapabilityRegistry } from '../capability-registry.service'

import { AccessUnavailableError } from './access-budget'
import {
  type AccessCapability,
  assertCatalogueWithinLimits,
  defaultCapabilities,
} from './access-capabilities'
import { explainAccess } from './access-evaluator'
import { loadAccess } from './access-loader'

/** The whole answer must fit the API cap; a larger one is refused, never shortened. */
export function assertResponseWithinCap(result: MemberAccess): void {
  if (serializedJsonBytes(result) > ACCESS_API_RESPONSE_BYTES)
    throw new AccessUnavailableError('responseTooLarge')
}

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
 * partial or unverifiable policy. The exact internal reason is logged once and never returned.
 */
@Injectable()
export class MemberAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CapabilityRegistry,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(MemberAccessService.name)
  }

  /** The registered capabilities; overridable so tests can model a larger catalogue. */
  protected capabilities(): readonly AccessCapability[] {
    return defaultCapabilities()
  }

  /** The database read; overridable so tests can prove that nothing is loaded for a refused request. */
  protected load(
    tx: Parameters<typeof loadAccess>[0],
    orgId: string,
    userId: string
  ): ReturnType<typeof loadAccess> {
    return loadAccess(tx, orgId, userId)
  }

  /** The evaluation; overridable so tests can model an answer the real inputs cannot reach cheaply. */
  protected build(
    loaded: Awaited<ReturnType<typeof loadAccess>>,
    capabilities: readonly AccessCapability[]
  ): MemberAccess {
    return explainAccess({ ...loaded, registry: this.registry, capabilities })
  }

  async explain(
    orgId: string,
    userId: string,
    actorOrganizationId: string | undefined
  ): Promise<MemberAccess> {
    if (orgId !== actorOrganizationId) throw new ForbiddenException()
    try {
      // The size of the catalogue is known without the database: refuse before loading anything.
      const capabilities = this.capabilities()
      assertCatalogueWithinLimits(capabilities)
      const result = await this.prisma.$transaction(
        async (tx) => this.build(await this.load(tx, orgId, userId), capabilities),
        { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 4000 }
      )
      assertResponseWithinCap(result)
      return result
    } catch (error) {
      if (error instanceof AppException || error instanceof ForbiddenException) throw error
      const reason = error instanceof AccessUnavailableError ? error.reason : 'unexpected'
      this.logger.warn(
        { event: 'org.member_access.unavailable', reason },
        'Member access unavailable'
      )
      throw unavailable()
    }
  }
}
