import { type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { SystemRole } from '@amcore/shared'

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../../common/exceptions'
import { PrismaService } from '../../../prisma'
import type { PrivilegedAdmission } from '../privileged-admission.service'

import { contextPolicyMetadata } from './context-policy-metadata'
import { organizationHeader, organizationSelector } from './organization-selector'
import type { RequestContextPolicyDefinition } from './request-context-policy'
import {
  type VerifiedOrganizationContext,
  verifiedOrganizationContext,
} from './verified-organization-context'

function legacyMembershipBypass(
  admission: PrivilegedAdmission,
  policy: Extract<RequestContextPolicyDefinition, { kind: 'organization' }>
): boolean {
  return (
    admission.authenticated.type === 'jwt' &&
    admission.authenticated.organizationId !== undefined &&
    policy.legacyPlatformMembershipBypass === true &&
    admission.principal.systemRole === SystemRole.SuperAdmin
  )
}

@Injectable()
export class OrganizationContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    execution: ExecutionContext,
    admission: PrivilegedAdmission
  ): Promise<{ admission: PrivilegedAdmission; context?: VerifiedOrganizationContext }> {
    const request = execution.switchToHttp().getRequest<Request>()
    const header = organizationHeader(request)
    const policy = contextPolicyMetadata(execution)
    if (!policy || policy.kind !== 'organization') {
      if (header !== undefined) throw new BadRequestException('Undeclared organization selector')
      return { admission }
    }
    const id = organizationSelector(request, policy, header)
    const { principal, authenticated } = admission
    if (
      (authenticated.type === 'api_key' || authenticated.organizationId !== undefined) &&
      authenticated.organizationId !== id
    ) {
      throw new ForbiddenException('Credential organization does not match target')
    }
    const aclVersion = await this.versionForTarget(admission, id, policy)
    const projected = Object.freeze({
      ...admission,
      principal: Object.freeze({ ...principal, organizationId: id, aclVersion }),
    })
    return {
      admission: projected,
      context: verifiedOrganizationContext(
        {
          organizationId: id,
          aclVersion,
          actorId: principal.sub,
          membershipVerified: !legacyMembershipBypass(admission, policy),
        },
        projected
      ),
    }
  }

  private async versionForTarget(
    admission: PrivilegedAdmission,
    id: string,
    policy: Extract<RequestContextPolicyDefinition, { kind: 'organization' }>
  ): Promise<number> {
    const { principal } = admission
    if (principal.type === 'api_key') {
      if (principal.aclVersion === undefined) throw new Error('Missing API-key authority snapshot')
      return principal.aclVersion
    }
    if (legacyMembershipBypass(admission, policy)) {
      const organization = await this.prisma.organization.findUnique({
        where: { id },
        select: { aclVersion: true },
      })
      if (!organization) throw new NotFoundException('Organization', id)
      return organization.aclVersion
    }
    const member = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId: principal.sub, organizationId: id } },
      include: { organization: { select: { aclVersion: true } } },
    })
    if (!member) {
      if (policy.concealMissing) throw new NotFoundException('Organization', id)
      throw new ForbiddenException('Organization membership is required')
    }
    return member.organization.aclVersion
  }
}
