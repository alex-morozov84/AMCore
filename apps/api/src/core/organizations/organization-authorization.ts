import { subject } from '@casl/ability'

import { Action, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException, NotFoundException } from '../../common/exceptions'
import type { AppAbility } from '../auth/casl/ability.factory'
import { ORG_READ_FIELDS } from '../auth/casl/org-role-defaults'

import type { Organization, Prisma } from '@/generated/prisma/client'

export function assertOrganizationAction(
  ability: AppAbility,
  action: Action,
  org: Organization,
  fields: readonly string[]
): void {
  const record = subject('Organization', org)
  if (!ability.can(action, record) || fields.some((field) => !ability.can(action, record, field))) {
    throw new ForbiddenException('Organization record or field permission denied')
  }
}

export function assertOrganizationResponse(ability: AppAbility, org: Organization): void {
  assertOrganizationAction(ability, Action.Read, org, ORG_READ_FIELDS)
}

export async function lockOrganization(
  tx: Prisma.TransactionClient,
  id: string,
  principal: RequestPrincipal
): Promise<Organization> {
  if (principal.organizationId !== id) throw new ForbiddenException('Organization context mismatch')
  await tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${id} FOR UPDATE`
  const org = await tx.organization.findUnique({ where: { id } })
  if (!org) throw new NotFoundException('Organization', id)
  if (principal.systemRole !== SystemRole.SuperAdmin) {
    const member = await tx.orgMember.findUnique({
      where: { userId_organizationId: { userId: principal.sub, organizationId: id } },
      select: { id: true },
    })
    if (!member) throw new ForbiddenException('Organization membership is required')
  }
  return org
}
