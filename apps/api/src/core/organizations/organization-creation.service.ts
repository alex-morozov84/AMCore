import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  type CreateOrganizationInput,
  organizationCreationIdSchema,
  type OrganizationCreationPolicy,
  type OrganizationCreationResult,
  type OrgResponse,
} from '@amcore/shared'

import { EnvService } from '../../env/env.service'
import { acquireXactLock, PrismaService } from '../../prisma'

import { canonicalAdmin } from './canonical-admin'
import {
  establishmentError,
  establishmentFailure,
  isOrganizationSlugConflict,
} from './establishment-error'
import { readEstablishmentResult, resultOrganization } from './establishment-result'
import { establishmentTransaction } from './establishment-transaction'
import { establishmentFingerprint, writeEstablishedOrganization } from './establishment-write'

export function generatedOrganizationSlug(name: string, collision = false): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
  if (base.length < 2) return `organization-${randomBytes(4).toString('hex')}`
  return collision
    ? `${base.slice(0, 41).replace(/-+$/, '')}-${randomBytes(4).toString('hex')}`
    : base
}

@Injectable()
export class OrganizationCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  policy(): OrganizationCreationPolicy {
    return { selfServiceCreationEnabled: this.env.get('ORG_SELF_SERVICE_CREATION_ENABLED') }
  }

  async result(actorId: string, operationId: string): Promise<OrganizationCreationResult> {
    this.validateId(operationId)
    try {
      return await establishmentTransaction(this.prisma, async (tx) => {
        const row = await readEstablishmentResult(tx, { actorId, operationId })
        if (!row) throw establishmentError('ORGANIZATION_CREATION_RESULT_NOT_FOUND', 404)
        if (!row.intact) throw establishmentError('ORGANIZATION_CREATION_RESULT_CHANGED')
        return { organizationId: row.organizationId, completedAt: row.completedAt.toISOString() }
      })
    } catch (error) {
      return establishmentFailure(error, false)
    }
  }

  async create(
    actorId: string,
    input: CreateOrganizationInput,
    operationId?: string
  ): Promise<OrgResponse> {
    if (!this.policy().selfServiceCreationEnabled)
      throw establishmentError('ORGANIZATION_CREATION_DISABLED', 403)
    if (operationId !== undefined) {
      this.validateId(operationId)
      operationId = operationId.toLowerCase()
    }
    const canonicalInputHash = establishmentFingerprint(input)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await establishmentTransaction(this.prisma, async (tx) => {
          if (operationId)
            await acquireXactLock(tx, `organization-creation:${actorId}:${operationId}`)
          await tx.$executeRaw`LOCK TABLE core.organizations IN ROW EXCLUSIVE MODE`
          if (
            operationId &&
            (await tx.organizationCreationResult.findUnique({
              where: {
                actorId_operationId: { actorId, operationId },
              },
            }))
          )
            return null
          const user = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } })
          if (!user) throw establishmentError('UNAUTHORIZED', 401)
          const adminRoleId = await canonicalAdmin(tx)
          const slug = input.slug ?? generatedOrganizationSlug(input.name, attempt > 0)
          const { organization, ids } = await writeEstablishedOrganization(
            tx,
            actorId,
            adminRoleId,
            { name: input.name, slug },
            { id: actorId, source: 'self-service' }
          )
          if (operationId)
            await tx.organizationCreationResult.create({
              data: {
                actorId,
                operationId,
                canonicalInputHash,
                organizationId: ids.organizationId,
                memberId: ids.memberId,
                adminRoleId,
                adminGrantId: ids.adminGrantId,
              },
            })
          return {
            ...organization,
            createdAt: organization.createdAt.toISOString(),
            updatedAt: organization.updatedAt.toISOString(),
          }
        })
        if (created) return created
        return await this.replay(actorId, operationId!, canonicalInputHash)
      } catch (error) {
        if (isOrganizationSlugConflict(error)) {
          if (input.slug) throw establishmentError('CONFLICT')
          if (attempt < 2) continue
          throw establishmentError('ORGANIZATION_CREATION_CONFLICT')
        }
        return establishmentFailure(error, false)
      }
    }
    throw establishmentError('ORGANIZATION_CREATION_CONFLICT')
  }

  private replay(actorId: string, operationId: string, fingerprint: string): Promise<OrgResponse> {
    return establishmentTransaction(this.prisma, async (tx) => {
      const row = await readEstablishmentResult(tx, { actorId, operationId })
      if (!row) throw establishmentError('ORGANIZATION_CREATION_UNCONFIRMED', 503)
      if (row.canonicalInputHash !== fingerprint)
        throw establishmentError('ORGANIZATION_CREATION_INTENT_MISMATCH')
      if (!row.intact) throw establishmentError('ORGANIZATION_CREATION_RESULT_CHANGED')
      return resultOrganization(row)
    })
  }

  private validateId(value: string): void {
    if (!organizationCreationIdSchema.safeParse(value).success)
      throw establishmentError('BAD_REQUEST', 400)
  }
}
