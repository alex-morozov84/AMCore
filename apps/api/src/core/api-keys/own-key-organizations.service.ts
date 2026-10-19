import { Injectable } from '@nestjs/common'

import {
  type OwnKeyOrganizations,
  type OwnKeyOrganizationsQuery,
  ownKeyOrganizationsSchema,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import {
  hasFullTeamAccess,
  normalizeOwnerPermissions,
} from '../auth/casl/permission-normalization.js'
import { memberPermissionSnapshot } from '../auth/member-permission-snapshot.js'

type CreationOption = Extract<OwnKeyOrganizations, { purpose: 'creation' }>['data'][number]

/** Bounded metadata only. Creation hints never authorize issuance. */
@Injectable()
export class OwnKeyOrganizationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actor: RequestPrincipal, q: OwnKeyOrganizationsQuery): Promise<OwnKeyOrganizations> {
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const eligible: Prisma.OrganizationWhereInput = {
          members: { some: { userId: actor.sub } },
          ...(q.purpose === 'inventory' && { apiKeys: { some: { userId: actor.sub } } }),
        }
        const search = q.search?.replace(/[\\%_]/g, (c) => `\\${c}`)
        const where = {
          ...eligible,
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { slug: { contains: search, mode: 'insensitive' as const } },
            ],
          }),
        }
        const select = { id: true, name: true, slug: true } as const
        const [data, total, selected, unavailable] = await Promise.all([
          tx.organization.findMany({
            where,
            select,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
          }),
          tx.organization.count({ where }),
          q.selectedId
            ? tx.organization.findFirst({
                where: { AND: [eligible, { id: q.selectedId }] },
                select,
              })
            : null,
          q.purpose === 'inventory'
            ? tx.apiKey.findFirst({
                where: {
                  userId: actor.sub,
                  organization: { members: { none: { userId: actor.sub } } },
                },
                select: { id: true },
              })
            : null,
        ])
        return { data, total, selected, hasUnavailable: Boolean(unavailable) }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
    if (q.purpose === 'inventory')
      return ownKeyOrganizationsSchema.parse({
        ...snapshot,
        page: q.page,
        limit: q.limit,
        purpose: q.purpose,
      })
    const options = [
      ...new Map(
        [...snapshot.data, ...(snapshot.selected ? [snapshot.selected] : [])].map((o) => [o.id, o])
      ).values(),
    ]
    const hints = new Map<string, boolean>()
    for (const option of options) {
      // Reuse the write-side evaluator and current persisted role. No fabricated false on failure.
      const hint = await this.prisma.$transaction(async (tx) => {
        const [member, user] = await Promise.all([
          memberPermissionSnapshot(tx, actor.sub, option.id),
          tx.user.findUniqueOrThrow({ where: { id: actor.sub }, select: { systemRole: true } }),
        ])
        return (
          Boolean(member.memberId) &&
          ((actor.systemRole === SystemRole.SuperAdmin &&
            user.systemRole === SystemRole.SuperAdmin) ||
            hasFullTeamAccess(
              normalizeOwnerPermissions(member.permissions, {
                ...actor,
                organizationId: option.id,
                systemRole: user.systemRole,
              })
            ))
        )
      })
      hints.set(option.id, hint)
    }
    const decorate = (o: (typeof options)[number]): CreationOption => ({
      ...o,
      canManageTeamAccess: hints.get(o.id)!,
    })
    return ownKeyOrganizationsSchema.parse({
      purpose: q.purpose,
      page: q.page,
      limit: q.limit,
      total: snapshot.total,
      hasUnavailable: false,
      data: snapshot.data.map(decorate),
      selected: snapshot.selected ? decorate(snapshot.selected) : null,
    })
  }
}
