import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import {
  type AdminOrganizationListResponse,
  type AdminOrganizationResponse,
  type AdminUserListResponse,
  type AdminUserResponse,
  type SystemRole,
} from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import type { CleanupResult } from '../../infrastructure/schedule/cleanup.service'
import { CleanupService } from '../../infrastructure/schedule/cleanup.service'
import { PrismaService } from '../../prisma'

/**
 * Prisma `select` allowlist for admin user responses (OA-07).
 *
 * Mirrors `adminUserResponseSchema` in `@amcore/shared` field-for-field.
 * Sensitive columns (`passwordHash`, `emailCanonical`) are absent so
 * the DB does not even read them. Adding a new sensitive column to
 * `User` cannot auto-leak — it must be explicitly added here.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  avatarUrl: true,
  phone: true,
  locale: true,
  timezone: true,
  systemRole: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const satisfies Prisma.UserSelect

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>

/**
 * Prisma `select` allowlist for admin organization responses (OA-08).
 *
 * Mirrors `adminOrganizationResponseSchema`. `aclVersion` (internal
 * RBAC freshness counter, ADR-035) is deliberately absent so the wire
 * shape does not depend on internal cache invalidation state.
 */
const ADMIN_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.OrganizationSelect

type AdminOrganizationRow = Prisma.OrganizationGetPayload<{
  select: typeof ADMIN_ORGANIZATION_SELECT
}>

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cleanupService: CleanupService
  ) {}

  async findAllUsers(page: number, limit: number): Promise<AdminUserListResponse> {
    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_USER_SELECT,
      }),
      this.prisma.user.count(),
    ])
    return {
      data: rows.map((row) => this.toAdminUserResponse(row)),
      total,
      page,
      limit,
    }
  }

  async updateUserSystemRole(id: string, systemRole: SystemRole): Promise<AdminUserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } })
    if (!user) throw new NotFoundException('User', id)
    const updated = await this.prisma.user.update({
      where: { id },
      data: { systemRole },
      select: ADMIN_USER_SELECT,
    })
    return this.toAdminUserResponse(updated)
  }

  runCleanup(): Promise<CleanupResult> {
    return this.cleanupService.runCleanup()
  }

  async findAllOrganizations(page: number, limit: number): Promise<AdminOrganizationListResponse> {
    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_ORGANIZATION_SELECT,
      }),
      this.prisma.organization.count(),
    ])
    return {
      data: rows.map((row) => this.toAdminOrganizationResponse(row)),
      total,
      page,
      limit,
    }
  }

  /**
   * Sole exit path from admin user reads (OA-07). Converts Prisma
   * `Date` columns into ISO strings so `@ZodSerializerDto` with
   * `z.iso.datetime()` validates correctly (interceptor runs before
   * Nest's JSON serialization). Mirrors the existing pattern in
   * `auth.service.ts:333-334` and `oauth.service.ts:241-242`.
   */
  private toAdminUserResponse(row: AdminUserRow): AdminUserResponse {
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      name: row.name,
      avatarUrl: row.avatarUrl,
      phone: row.phone,
      locale: row.locale,
      timezone: row.timezone,
      systemRole: row.systemRole,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    }
  }

  /** Sole exit path from admin organization reads (OA-08). */
  private toAdminOrganizationResponse(row: AdminOrganizationRow): AdminOrganizationResponse {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
