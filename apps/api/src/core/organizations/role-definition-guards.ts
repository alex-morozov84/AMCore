import { HttpStatus } from '@nestjs/common'

import {
  isReservedRoleName,
  type RequestPrincipal,
  ROLE_NAME_MAX,
  ROLE_NAME_MIN,
  RoleDefinitionErrorCode as Code,
  type RoleDefinitionPreset,
} from '@amcore/shared'

import { AppException, BadRequestException } from '../../common/exceptions'

import { CAPABILITY_ADAPTERS } from './capability-registry.service'
import { assignableRolesWhere } from './role-assignability-policy'

import type { Prisma, Role } from '@/generated/prisma/client'

type Tx = Prisma.TransactionClient

export const fail = (status: HttpStatus, code: Code, message: string): AppException =>
  new AppException(message, status, code)

export const conflict = (): AppException =>
  fail(HttpStatus.CONFLICT, Code.ROLE_DEFINITION_CONFLICT, 'Role definition changed')

export const oversized = (): AppException =>
  fail(HttpStatus.CONFLICT, Code.ROLE_DEFINITION_OVERSIZED, 'Role definition is too large')

export const normalizeDescription = (value: string | null | undefined): string | null =>
  value?.trim() ? value.trim() : null

const ROLE_NAME_UNIQUE_INDEX = 'roles_organizationId_name_key'

/**
 * A unique violation of the role `(organizationId, name)` constraint ONLY. Prisma 7 with the pg
 * driver adapter reports `meta.modelName` and `meta.driverAdapterError.cause.constraint.index`
 * (verified against the installed client); any other unique violation is not a name conflict.
 */
export function isRoleNameConflict(error: unknown): boolean {
  const known = error as {
    code?: string
    meta?: {
      modelName?: string
      target?: unknown
      driverAdapterError?: { cause?: { constraint?: { index?: string } } }
    }
  } | null
  if (known?.code !== 'P2002') return false
  const index = known.meta?.driverAdapterError?.cause?.constraint?.index
  if (index !== undefined) return index === ROLE_NAME_UNIQUE_INDEX
  const target = known.meta?.target
  // Fallback for clients that report columns instead of an index: exactly the compound key.
  return (
    known.meta?.modelName === 'Role' &&
    Array.isArray(target) &&
    target.length === 2 &&
    target.includes('organizationId') &&
    target.includes('name')
  )
}

/** A custom role of this organization; built-in roles are readable elsewhere but never writable. */
export async function customRole(tx: Tx, orgId: string, roleId: string): Promise<Role> {
  const role = await tx.role.findFirst({ where: { id: roleId, ...assignableRolesWhere(orgId) } })
  if (!role) throw fail(HttpStatus.NOT_FOUND, Code.ROLE_UNAVAILABLE, 'Role unavailable')
  if (role.isSystem)
    throw fail(HttpStatus.FORBIDDEN, Code.ROLE_SYSTEM_IMMUTABLE, 'System roles cannot be modified')
  return role
}

/** Compare-and-bump the organization revision; a concurrent writer surfaces as a stable conflict. */
export async function bumpRevision(tx: Tx, orgId: string, expected: number): Promise<number> {
  const cas = await tx.organization.updateMany({
    where: { id: orgId, aclVersion: expected },
    data: { aclVersion: { increment: 1 } },
  })
  if (cas.count !== 1) throw conflict()
  return expected + 1
}

export function assertNameBounds(name: string): void {
  if ([...name].length < ROLE_NAME_MIN || [...name].length > ROLE_NAME_MAX)
    throw new BadRequestException('Role name must be 2-50 characters after trimming')
}

/** New or changed names may not take a built-in role name. */
export function assertNewName(name: string): void {
  if (isReservedRoleName(name))
    throw fail(HttpStatus.BAD_REQUEST, Code.ROLE_NAME_RESERVED, 'Role name is reserved')
}

/** Case-insensitive collision among current organization roles, checked under the parent lock. */
export async function assertNoCollision(
  tx: Tx,
  orgId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.role.findFirst({
    where: {
      organizationId: orgId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  })
  if (clash) throw fail(HttpStatus.CONFLICT, Code.ROLE_NAME_CONFLICT, 'Role name already exists')
}

export async function selfHolds(
  tx: Tx,
  orgId: string,
  roleId: string,
  principal: RequestPrincipal
): Promise<boolean> {
  const held = await tx.memberRole.count({
    where: { roleId, member: { organizationId: orgId, userId: principal.sub } },
  })
  return held > 0
}

export function liveInvitations(tx: Tx, orgId: string, roleId: string): Promise<number> {
  return tx.orgInviteRoleIntent.count({
    where: {
      liveRoleId: roleId,
      invite: {
        organizationId: orgId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    },
  })
}

export interface SaveAcknowledgments {
  acknowledgeFullControl?: true
  acknowledgeSelfHeld?: true
}

/**
 * Interaction controls enforced by the server: adding a full-control descriptor and changing the
 * presets of a role the actor holds each need an explicit request flag. They are not a delegation
 * limit; legacy advanced routes can still grant the same authority.
 */
export async function assertAcknowledgments(
  tx: Tx,
  orgId: string,
  roleId: string,
  principal: RequestPrincipal,
  acknowledgments: SaveAcknowledgments,
  additions: RoleDefinitionPreset[],
  presetChange: boolean
): Promise<void> {
  const addsFullControl = additions.some(
    (preset) => CAPABILITY_ADAPTERS[preset.capabilityId].risk === 'fullControl'
  )
  if (addsFullControl && !acknowledgments.acknowledgeFullControl)
    throw fail(
      HttpStatus.BAD_REQUEST,
      Code.ROLE_FULL_CONTROL_ACK_REQUIRED,
      'Acknowledge full control'
    )
  if (
    presetChange &&
    !acknowledgments.acknowledgeSelfHeld &&
    (await selfHolds(tx, orgId, roleId, principal))
  )
    throw fail(
      HttpStatus.BAD_REQUEST,
      Code.ROLE_SELF_HELD_ACK_REQUIRED,
      'Acknowledge self-held role'
    )
}
