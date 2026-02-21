import { randomBytes } from 'node:crypto'

import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common'
import type { Organization } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../common/exceptions'
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
      throw new InternalServerErrorException(
        'System roles not initialized. Run: pnpm --filter api prisma:seed'
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

  async findOne(id: string, userId: string): Promise<Organization> {
    const [org, member] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id } }),
      this.prisma.orgMember.findUnique({
        where: { userId_organizationId: { userId, organizationId: id } },
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
