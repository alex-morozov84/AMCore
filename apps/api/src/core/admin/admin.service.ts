import { Injectable } from '@nestjs/common'
import type { Organization, User } from '@prisma/client'

import { type SystemRole } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllUsers(page = 1, limit = DEFAULT_LIMIT): Promise<{ data: User[]; total: number }> {
    const take = Math.min(limit, MAX_LIMIT)
    const skip = (page - 1) * take
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count(),
    ])
    return { data, total }
  }

  async updateUserSystemRole(id: string, systemRole: SystemRole): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('User', id)
    return this.prisma.user.update({ where: { id }, data: { systemRole } })
  }

  async findAllOrganizations(
    page = 1,
    limit = DEFAULT_LIMIT
  ): Promise<{ data: Organization[]; total: number }> {
    const take = Math.min(limit, MAX_LIMIT)
    const skip = (page - 1) * take
    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.organization.count(),
    ])
    return { data, total }
  }
}
