import { HttpException, HttpStatus, Injectable } from '@nestjs/common'

import {
  escapeLikeLiteral,
  type RequestPrincipal,
  ROLE_DETAIL_API_RESPONSE_BYTES,
  ROLE_EDITABLE_RULE_LIMIT,
  ROLE_LIST_API_RESPONSE_BYTES,
  ROLE_LIST_CLASSIFY_BYTES,
  ROLE_LIST_CLASSIFY_ROWS,
  type RoleDefinitionDetail,
  RoleDefinitionErrorCode as Code,
  type RoleDefinitionListQuery,
  type RoleDefinitionListResponse,
  type RoleSummary,
  serializedJsonBytes,
} from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { assignableRolesWhere } from './role-assignability-policy'
import { buildRoleDetail, isOversized, rulePreflight, splitRules } from './role-definition-detail'

import type { Prisma } from '@/generated/prisma/client'

const roleMetaSelect = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  organizationId: true,
} as const
const order = [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }] as const
/** A role contributing to the page's classification budget may not exceed this serialized size alone. */
const LIST_CLASSIFY_ROLE_BYTES = 65_536

@Injectable()
export class RoleDefinitionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    orgId: string,
    actorOrg: string | undefined,
    query: RoleDefinitionListQuery
  ): Promise<RoleDefinitionListResponse> {
    this.assertContext(orgId, actorOrg)
    return this.read(async (tx) => {
      const aclVersion = await this.aclVersion(tx, orgId)
      const where: Prisma.RoleWhereInput = {
        ...assignableRolesWhere(orgId),
        ...(query.search && {
          name: { contains: escapeLikeLiteral(query.search), mode: 'insensitive' },
        }),
      }
      const total = await tx.role.count({ where })
      const rows = await tx.role.findMany({
        where,
        select: roleMetaSelect,
        orderBy: [...order],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      })
      const ids = rows.map((row) => row.id)
      const [counts, preflight] = await Promise.all([
        this.holderCounts(tx, orgId, ids),
        rulePreflight(tx, ids),
      ])
      const advanced = await this.advancedStates(tx, rows, preflight)
      const data: RoleSummary[] = rows.map((row) => {
        const rules = preflight.get(row.id)!
        return {
          ...row,
          holderCount: counts.get(row.id) ?? 0,
          ruleCount: rules.ruleCount,
          grantsFullControl: rules.fullControl,
          advancedState: rules.ruleCount === 0 ? 'none' : (advanced.get(row.id) ?? 'unknown'),
        }
      })
      const response = { data, total, page: query.page, limit: query.limit, aclVersion }
      if (serializedJsonBytes(response) > ROLE_LIST_API_RESPONSE_BYTES) throw this.unavailable()
      return response
    })
  }

  async detail(
    orgId: string,
    roleId: string,
    principal: RequestPrincipal
  ): Promise<RoleDefinitionDetail> {
    this.assertContext(orgId, principal.organizationId)
    return this.read(async (tx) => {
      const aclVersion = await this.aclVersion(tx, orgId)
      const role = await tx.role.findFirst({
        where: { id: roleId, ...assignableRolesWhere(orgId) },
        select: roleMetaSelect,
      })
      if (!role)
        throw new AppException('Role unavailable', HttpStatus.NOT_FOUND, Code.ROLE_UNAVAILABLE)
      const preflight = (await rulePreflight(tx, [role.id])).get(role.id)!
      const detail = await buildRoleDetail(tx, {
        orgId,
        role,
        aclVersion,
        actorUserId: principal.sub,
        now: new Date(),
        preflight,
      })
      if (serializedJsonBytes(detail) > ROLE_DETAIL_API_RESPONSE_BYTES) throw this.unavailable()
      return detail
    })
  }

  /** Memberships of THIS organization per role in one grouped query (never a cross-tenant count). */
  private async holderCounts(
    tx: Prisma.TransactionClient,
    orgId: string,
    roleIds: string[]
  ): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map()
    const groups = await tx.memberRole.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roleIds }, member: { organizationId: orgId } },
      _count: { _all: true },
    })
    return new Map(groups.map((group) => [group.roleId, group._count._all]))
  }

  /**
   * Classify rules only for roles inside the per-page load budget (rows and bytes, per role and in
   * total); every other role reports `unknown`, never an unbounded include of 100 roles' rules.
   */
  private async advancedStates(
    tx: Prisma.TransactionClient,
    rows: { id: string; isSystem: boolean }[],
    preflight: Awaited<ReturnType<typeof rulePreflight>>
  ): Promise<Map<string, 'none' | 'present'>> {
    const eligible: string[] = []
    let rowBudget = ROLE_LIST_CLASSIFY_ROWS
    let byteBudget = ROLE_LIST_CLASSIFY_BYTES
    for (const row of rows) {
      const rules = preflight.get(row.id)!
      if (rules.ruleCount === 0) continue
      const fits =
        rules.ruleCount <= ROLE_EDITABLE_RULE_LIMIT &&
        rules.ruleBytes <= LIST_CLASSIFY_ROLE_BYTES &&
        rules.ruleCount <= rowBudget &&
        rules.ruleBytes <= byteBudget &&
        (row.isSystem || !isOversized(rules))
      if (!fits) continue
      rowBudget -= rules.ruleCount
      byteBudget -= rules.ruleBytes
      eligible.push(row.id)
    }
    const states = new Map<string, 'none' | 'present'>()
    if (eligible.length === 0) return states
    const links = await tx.rolePermission.findMany({
      where: { roleId: { in: eligible } },
      select: {
        roleId: true,
        permission: {
          select: {
            id: true,
            action: true,
            subject: true,
            conditions: true,
            fields: true,
            inverted: true,
          },
        },
      },
      orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
    })
    const byRole = new Map<string, typeof links>()
    for (const link of links) byRole.set(link.roleId, [...(byRole.get(link.roleId) ?? []), link])
    for (const roleId of eligible) {
      const rules = (byRole.get(roleId) ?? []).map((link) => link.permission)
      states.set(roleId, splitRules(rules).advanced.length > 0 ? 'present' : 'none')
    }
    return states
  }

  /**
   * One RepeatableRead snapshot per read. Deliberate semantic rejections (403/404) escape unchanged;
   * any unexpected failure is the single agreed `ROLE_READ_UNAVAILABLE`, never a partial detail or a
   * raw infrastructure error.
   */
  private async read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { isolationLevel: 'RepeatableRead' })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw this.unavailable()
    }
  }

  private assertContext(orgId: string, actorOrg: string | undefined): void {
    if (orgId !== actorOrg) throw new ForbiddenException()
  }

  private async aclVersion(tx: Prisma.TransactionClient, orgId: string): Promise<number> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { aclVersion: true },
    })
    if (!org)
      throw new AppException(
        'Organization unavailable',
        HttpStatus.NOT_FOUND,
        Code.ROLE_UNAVAILABLE
      )
    return org.aclVersion
  }

  private unavailable(): AppException {
    return new AppException(
      'Role read exceeds budget',
      HttpStatus.SERVICE_UNAVAILABLE,
      Code.ROLE_READ_UNAVAILABLE
    )
  }
}
