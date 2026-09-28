import { Injectable } from '@nestjs/common'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

/** Select the current permission-cache fence from the primary database. */
@Injectable()
export class OrgAclVersionService {
  private dbQueries = 0

  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(orgId: string): Promise<number> {
    this.dbQueries++
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { aclVersion: true },
    })
    if (!org) throw new NotFoundException('Organization', orgId)
    return org.aclVersion
  }

  /** @deprecated Current versions are no longer cached; retained for callers. */
  async invalidate(_orgId: string): Promise<void> {
    // No publication is needed: every authority lookup reads the primary DB.
  }

  getMetrics(): { dbQueries: number } {
    return { dbQueries: this.dbQueries }
  }

  resetMetrics(): void {
    this.dbQueries = 0
  }
}
