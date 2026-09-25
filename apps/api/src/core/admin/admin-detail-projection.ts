import {
  type AdminOrganizationResponse,
  type AdminUserResponse,
  parseSupportedLocale,
} from '@amcore/shared'

import type { Prisma } from '@/generated/prisma/client'

export const DETAIL_USER_SELECT = {
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

export const DETAIL_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.OrganizationSelect

export const USER_MEMBERSHIP_SELECT = {
  id: true,
  createdAt: true,
  organization: { select: { id: true, name: true, slug: true } },
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const satisfies Prisma.OrgMemberSelect

export const ORGANIZATION_MEMBER_SELECT = {
  id: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const satisfies Prisma.OrgMemberSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof DETAIL_USER_SELECT }>
type OrganizationRow = Prisma.OrganizationGetPayload<{ select: typeof DETAIL_ORGANIZATION_SELECT }>

export function projectDetailUser(row: UserRow): AdminUserResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name,
    avatarUrl: row.avatarUrl,
    phone: row.phone,
    locale: parseSupportedLocale(row.locale),
    timezone: row.timezone,
    systemRole: row.systemRole,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }
}

export function projectDetailOrganization(row: OrganizationRow): AdminOrganizationResponse {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function projectRoles(
  roles: { role: { id: string; name: string } }[]
): { id: string; name: string }[] {
  return roles
    .map(({ role }) => role)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
