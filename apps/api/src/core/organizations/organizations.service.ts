import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  Action,
  type OrganizationListResponse,
  type OrgResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { ConflictException, ForbiddenException, NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import type { AppAbility } from '../auth/casl/ability.factory'
import { ORG_READ_FIELDS } from '../auth/casl/org-role-defaults'
import { OrgAclVersionService } from '../auth/org-acl-version.service'

import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto'
import {
  assertOrganizationAction,
  assertOrganizationResponse,
  lockOrganization,
} from './organization-authorization'
import { getSystemRoleId } from './system-role'

import type { Organization, Prisma } from '@/generated/prisma/client'

type PrismaTx = Prisma.TransactionClient

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclVersionService: OrgAclVersionService
  ) {}

  async create(userId: string, dto: CreateOrganizationDto): Promise<OrgResponse> {
    const slug = dto.slug ?? (await this.generateSlug(dto.name))

    if (dto.slug) {
      const existing = await this.prisma.organization.findUnique({ where: { slug } })
      if (existing) throw new ConflictException(`Slug '${slug}' is already taken`)
    }

    const adminRoleId = await getSystemRoleId(this.prisma, 'ADMIN')

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.name, slug } })
      const member = await tx.orgMember.create({ data: { userId, organizationId: org.id } })
      await tx.memberRole.create({ data: { memberId: member.id, roleId: adminRoleId } })
      return this.toOrgResponse(org)
    })
  }

  async findAllForUser(
    userId: string,
    page: number,
    limit: number
  ): Promise<OrganizationListResponse> {
    // ADR-036: paginated envelope. ORDER BY createdAt DESC, id ASC on
    // the join (sort the organizations by their own createdAt, with
    // id as the tie-break for deterministic page boundaries).
    const skip = (page - 1) * limit
    const [memberships, total] = await Promise.all([
      this.prisma.orgMember.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: [{ organization: { createdAt: 'desc' } }, { organization: { id: 'asc' } }],
        include: { organization: true },
      }),
      this.prisma.orgMember.count({ where: { userId } }),
    ])
    return {
      data: memberships.map((m) => this.toOrgResponse(m.organization)),
      total,
      page,
      limit,
    }
  }

  private toOrgResponse(org: Organization): OrgResponse {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      aclVersion: org.aclVersion,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    }
  }

  async findOne(
    id: string,
    principal: RequestPrincipal,
    ability: AppAbility
  ): Promise<OrgResponse> {
    // OA-03: api_key principals are constrained on two axes; JWT
    // principals fall through both checks and rely on the membership
    // check below.
    if (principal.type === 'api_key') {
      // Bound-org boundary. 403 (not 404) — credential-boundary
      // violation, not org-existence concealment; the e2e scenario
      // explicitly builds owner membership in both orgs to prove the
      // boundary fires, not a missing membership.
      if (principal.organizationId !== id) {
        throw new ForbiddenException(
          'API key is bound to a different organization and cannot read this one'
        )
      }
    }

    const [org, member] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id } }),
      this.prisma.orgMember.findUnique({
        where: { userId_organizationId: { userId: principal.sub, organizationId: id } },
      }),
    ])
    // OB-04: from a non-member JWT principal, missing org and
    // existing-but-not-member must produce the same response so an
    // attacker cannot enumerate org IDs by status code. The API-key
    // branch above intentionally keeps 403 — that path is a
    // credential-boundary violation (OA-03), not concealment, and the
    // caller has already authenticated as a key bound to a different
    // org.
    if (!org || !member) throw new NotFoundException('Organization', id)
    if (principal.type === 'api_key') assertOrganizationResponse(ability, org)
    return this.toOrgResponse(org)
  }

  async update(
    id: string,
    principal: RequestPrincipal,
    dto: UpdateOrganizationDto,
    ability: AppAbility
  ): Promise<OrgResponse> {
    this.assertOrgContext(principal, id)
    const org = await this.prisma.$transaction(async (tx) => {
      const before = await lockOrganization(tx, id, principal)
      const fields = Object.keys(dto).filter(
        (field) => dto[field as keyof UpdateOrganizationDto] !== undefined
      )
      assertOrganizationAction(ability, Action.Update, before, fields)
      if (fields.length === 0) {
        assertOrganizationResponse(ability, before)
        return before
      }
      if (dto.slug) {
        const conflict = await tx.organization.findFirst({
          where: { slug: dto.slug, id: { not: id } },
        })
        if (conflict) throw new ConflictException(`Slug '${dto.slug}' is already taken`)
      }
      const after = await tx.organization.update({ where: { id }, data: dto })
      assertOrganizationAction(ability, Action.Update, after, fields)
      assertOrganizationResponse(ability, after)
      return after
    })
    return this.toOrgResponse(org)
  }

  async remove(id: string, principal: RequestPrincipal, ability: AppAbility): Promise<void> {
    this.assertOrgContext(principal, id)
    await this.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, id, principal)
      assertOrganizationAction(ability, Action.Delete, org, ORG_READ_FIELDS)
      await tx.organization.delete({ where: { id } })
    })
  }

  /** Returns org data needed to generate a new JWT with this org's context */
  async getForSwitch(orgId: string, userId: string): Promise<{ aclVersion: number }> {
    const member = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      include: { organization: { select: { aclVersion: true } } },
    })
    if (!member) throw new ForbiddenException('You are not a member of this organization')
    return { aclVersion: member.organization.aclVersion }
  }

  /**
   * Increment aclVersion to bust permissions cache for this org —
   * non-transactional variant. Retained per ADR-035 for one-off
   * callers that don't have an enclosing `$transaction` (e.g.
   * future admin operations). ACL mutation sites in
   * `MemberService` / `RoleService` must use {@link bumpAclVersionTx}
   * so the bump rolls back with the mutation.
   *
   * Current ACL authority is read from the primary database. The retained
   * post-update invalidation seam is a compatibility no-op.
   */
  async bumpAclVersion(orgId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    await this.invalidateAclVersion(orgId)
  }

  async invalidateAclVersion(orgId: string): Promise<void> {
    await this.aclVersionService.invalidate(orgId)
  }

  /**
   * Transactional variant of {@link bumpAclVersion} for ADR-035 / OA-12.
   *
   * Must be called inside the same `$transaction` as the ACL mutation
   * whose effect this bump is meant to invalidate. If the surrounding
   * transaction rolls back, the increment rolls back with it — the
   * cache version and the DB ACL state can no longer drift on
   * transient DB failures.
   *
   * No post-commit publication is required for freshness. Existing callers
   * may retain the compatibility no-op invalidate call after commit.
   */
  async bumpAclVersionTx(orgId: string, tx: PrismaTx): Promise<void> {
    await tx.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException(
        'Organization context mismatch — call POST /organizations/:id/switch first'
      )
    }
  }

  private async generateSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')

    const existing = await this.prisma.organization.findUnique({ where: { slug: base } })
    if (!existing) return base

    const suffix = randomBytes(3).toString('hex')
    return `${base}-${suffix}`
  }
}
