import { randomBytes } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import type { Organization, Prisma } from '@prisma/client'

import { Action, type RequestPrincipal, Subject } from '@amcore/shared'

import {
  AppException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import type { AppAbility } from '../auth/casl/ability.factory'
import { OrgAclVersionService } from '../auth/org-acl-version.service'

import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto'

type PrismaTx = Prisma.TransactionClient

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aclVersionService: OrgAclVersionService
  ) {}

  async create(userId: string, dto: CreateOrganizationDto): Promise<Organization> {
    const slug = dto.slug ?? (await this.generateSlug(dto.name))

    if (dto.slug) {
      const existing = await this.prisma.organization.findUnique({ where: { slug } })
      if (existing) throw new ConflictException(`Slug '${slug}' is already taken`)
    }

    const adminRole = await this.prisma.role.findFirst({
      where: { name: 'ADMIN', isSystem: true, organizationId: null },
    })
    if (!adminRole) {
      throw new AppException(
        'System roles not initialized. Run: pnpm --filter api prisma:seed',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'SYSTEM_NOT_INITIALIZED'
      )
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.name, slug } })
      const member = await tx.orgMember.create({ data: { userId, organizationId: org.id } })
      await tx.memberRole.create({ data: { memberId: member.id, roleId: adminRole.id } })
      return org
    })
  }

  async findAllForUser(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId },
      include: { organization: true },
    })
    return memberships.map((m) => m.organization)
  }

  async findOne(
    id: string,
    principal: RequestPrincipal,
    ability: AppAbility
  ): Promise<Organization> {
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
      // userPerms ∩ scopes invariant (ADR-033). The ability was built
      // by AbilityFactory from `permsInBoundOrg ∩ apiKey.scopes`, so a
      // key with `read:User` produces no rule on Organization and
      // `can(Read, Organization)` is false. This is what blocks a
      // narrowly-scoped key from reading the org record even within
      // its own bound org. JWT principals are NOT checked here:
      // without org-context their ability is the personal empty
      // ability, and applying the same check would break the
      // "browse-before-switch" UI flow that OA-03 deliberately
      // preserves.
      if (!ability.can(Action.Read, Subject.Organization)) {
        throw new ForbiddenException('API key scope does not allow reading this organization')
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
    return org
  }

  async update(
    id: string,
    principal: RequestPrincipal,
    dto: UpdateOrganizationDto
  ): Promise<Organization> {
    this.assertOrgContext(principal, id)

    if (dto.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: dto.slug, id: { not: id } },
      })
      if (existing) throw new ConflictException(`Slug '${dto.slug}' is already taken`)
    }

    return this.prisma.organization.update({ where: { id }, data: dto })
  }

  async remove(id: string, principal: RequestPrincipal): Promise<void> {
    this.assertOrgContext(principal, id)
    await this.prisma.organization.delete({ where: { id } })
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
   * Post-commit cache invalidation runs after the DB update. If Redis
   * invalidation fails, `OrgAclVersionService` records an error-level
   * freshness incident but does not turn a committed DB mutation into
   * a false client failure.
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
   * Cache invalidation (OA-04) is the caller's job: call
   * `OrgAclVersionService.invalidate(orgId)` after the surrounding
   * `$transaction` commits successfully. Doing the Redis `DEL` inside
   * the transaction would mix non-transactional I/O into the unit of
   * work — a rollback would not undo it, breaking the freshness
   * contract in the opposite direction (cache emptied for an
   * un-applied bump).
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
