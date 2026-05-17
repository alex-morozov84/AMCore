import { randomBytes } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import type { Organization } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import {
  AppException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto'

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findOne(id: string, principal: RequestPrincipal): Promise<Organization> {
    // OA-03: API-key principals are bound to one org per ADR-033 and
    // must not read another org's record, even if the owning user is
    // also a member there. The check is 403 (not 404) because this is a
    // credential-boundary violation, not org-existence concealment —
    // the test scenario explicitly builds owner membership in both orgs
    // to prove the boundary fires, not a missing membership.
    if (principal.type === 'api_key' && principal.organizationId !== id) {
      throw new ForbiddenException(
        'API key is bound to a different organization and cannot read this one'
      )
    }

    const [org, member] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id } }),
      this.prisma.orgMember.findUnique({
        where: { userId_organizationId: { userId: principal.sub, organizationId: id } },
      }),
    ])
    if (!org) throw new NotFoundException('Organization', id)
    if (!member) throw new ForbiddenException('You are not a member of this organization')
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

  /** Increment aclVersion to bust permissions cache for this org */
  async bumpAclVersion(orgId: string): Promise<void> {
    await this.prisma.organization.update({
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
