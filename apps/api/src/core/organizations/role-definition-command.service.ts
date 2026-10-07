import { HttpException, HttpStatus, Injectable } from '@nestjs/common'

import {
  type CreateRoleDefinition,
  type DeleteRoleDefinition,
  type DeleteRoleDefinitionResponse,
  type RequestPrincipal,
  ROLE_DETAIL_API_RESPONSE_BYTES,
  type RoleDefinitionDetail,
  RoleDefinitionErrorCode as Code,
  type RoleDefinitionPreset,
  type SaveRoleDefinition,
  type SaveRoleDefinitionResponse,
  serializedJsonBytes,
} from '@amcore/shared'

import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import { CapabilityRegistry } from './capability-registry.service'
import { lockOrganization } from './organization-mutation-lock'
import { OrganizationsService } from './organizations.service'
import { fullControlTransition, recordRoleDefinition } from './role-definition-audit'
import { presetKey } from './role-definition-classifier'
import {
  buildRoleDetail,
  isOversized,
  loadRoleRules,
  type RulePreflight,
  rulePreflight,
} from './role-definition-detail'
import {
  assertAcknowledgments,
  assertNameBounds,
  assertNewName,
  assertNoCollision,
  bumpRevision,
  conflict,
  customRole,
  fail,
  liveInvitations,
  normalizeDescription,
  oversized,
  selfHolds,
} from './role-definition-guards'
import {
  attachPreset,
  collectOrphans,
  detachAndCollect,
  planPresetChange,
} from './role-definition-rules'

import type { Prisma, Role } from '@/generated/prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Role-definition commands. Every writer takes ONLY the parent organization lock (never a user or
 * last-admin advisory lock afterwards), compares the revision, applies the change, bumps the revision
 * once and writes one strict in-transaction audit row; the response is built from the post-write state
 * before commit so an acknowledged write never depends on a new read. Each command is a linear
 * transaction script: its steps must stay in this order under one lock, so it is kept together and
 * the reusable rules live in `role-definition-guards` and `role-definition-rules`.
 */
@Injectable()
export class RoleDefinitionCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditLogService,
    private readonly registry: CapabilityRegistry
  ) {}

  create(
    orgId: string,
    dto: CreateRoleDefinition,
    principal: RequestPrincipal
  ): Promise<RoleDefinitionDetail> {
    this.assertContext(orgId, principal)
    return this.run(orgId, async (tx) => {
      const org = await lockOrganization(tx, orgId)
      const name = dto.name.trim()
      const description = normalizeDescription(dto.description)
      assertNewName(name)
      await assertNoCollision(tx, orgId, name)
      const role = await tx.role.create({
        data: { name, description, organizationId: orgId, isSystem: false },
      })
      const aclVersion = await bumpRevision(tx, orgId, org.aclVersion)
      const detail = await this.detail(tx, orgId, role, aclVersion, principal)
      await recordRoleDefinition(this.audit, tx, 'org.role_created', orgId, principal, {
        roleId: role.id,
        revisionBefore: org.aclVersion,
        revisionAfter: aclVersion,
        addedPresetCount: 0,
        removedPresetCount: 0,
        fullControl: 'none',
        holderCount: 0,
        liveInvitationCount: 0,
        nameChanged: true,
        descriptionChanged: description !== null,
        source: 'editor',
      })
      return detail
    })
  }

  save(
    orgId: string,
    roleId: string,
    dto: SaveRoleDefinition,
    principal: RequestPrincipal
  ): Promise<SaveRoleDefinitionResponse> {
    this.assertContext(orgId, principal)
    return this.run(orgId, async (tx) => {
      const org = await lockOrganization(tx, orgId)
      const role = await customRole(tx, orgId, roleId)
      if (org.aclVersion !== dto.expectedAclVersion) throw conflict()
      const before = (await rulePreflight(tx, [roleId])).get(roleId)!
      if (isOversized(before)) throw oversized()
      return this.applySave(tx, { orgId, role, dto, principal, before })
    })
  }

  private async applySave(
    tx: Tx,
    ctx: {
      orgId: string
      role: Role
      dto: SaveRoleDefinition
      principal: RequestPrincipal
      before: RulePreflight
    }
  ): Promise<SaveRoleDefinitionResponse> {
    const { orgId, role, dto, principal, before } = ctx
    const plan = planPresetChange(
      await loadRoleRules(tx, role.id),
      this.desiredPresets(dto.presets)
    )
    // Raw equality with the stored value preserves it verbatim (a preset-only save is not a rename).
    const nameChanged = dto.name !== role.name
    const name = nameChanged ? dto.name.trim() : role.name
    const descriptionChanged = dto.description !== role.description
    const description = descriptionChanged
      ? normalizeDescription(dto.description)
      : role.description
    if (nameChanged) {
      assertNameBounds(name)
      assertNewName(name)
      await assertNoCollision(tx, orgId, name, role.id)
    }
    const presetChange = plan.removeIds.length > 0 || plan.additions.length > 0
    await assertAcknowledgments(tx, orgId, role.id, principal, dto, plan.additions, presetChange)
    if (!nameChanged && !descriptionChanged && !presetChange) {
      const current = await this.detail(tx, orgId, role, dto.expectedAclVersion, principal)
      return { detail: current, changed: false }
    }

    if (nameChanged || descriptionChanged)
      await tx.role.update({ where: { id: role.id }, data: { name, description } })
    if (plan.removeIds.length > 0) await detachAndCollect(tx, orgId, role.id, plan.removeIds)
    for (const preset of plan.additions)
      await attachPreset(tx, orgId, role.id, this.registry.preset(preset))
    const aclVersion = await bumpRevision(tx, orgId, dto.expectedAclVersion)
    const after = (await rulePreflight(tx, [role.id])).get(role.id)!
    if (isOversized(after)) throw oversized()
    const detail = await this.detail(
      tx,
      orgId,
      { ...role, name, description },
      aclVersion,
      principal
    )
    const response = { detail, changed: true }
    if (serializedJsonBytes(response) > ROLE_DETAIL_API_RESPONSE_BYTES) throw oversized()
    await recordRoleDefinition(this.audit, tx, 'org.role_updated', orgId, principal, {
      roleId: role.id,
      revisionBefore: dto.expectedAclVersion,
      revisionAfter: aclVersion,
      addedPresetCount: plan.additions.length,
      removedPresetCount: plan.removedPresets,
      fullControl: fullControlTransition(before.fullControl, after.fullControl),
      holderCount: detail.holders.total,
      liveInvitationCount: detail.impact.liveInvitationCount,
      nameChanged,
      descriptionChanged,
      source: 'editor',
    })
    return response
  }

  remove(
    orgId: string,
    roleId: string,
    dto: DeleteRoleDefinition,
    principal: RequestPrincipal
  ): Promise<DeleteRoleDefinitionResponse> {
    this.assertContext(orgId, principal)
    return this.run(orgId, async (tx) => {
      const org = await lockOrganization(tx, orgId)
      await customRole(tx, orgId, roleId)
      if (org.aclVersion !== dto.expectedAclVersion) throw conflict()
      const [holders, live, preflight] = await Promise.all([
        tx.memberRole.count({ where: { roleId, member: { organizationId: orgId } } }),
        liveInvitations(tx, orgId, roleId),
        rulePreflight(tx, [roleId]),
      ])
      if (live !== dto.expectedLiveInvitationCount)
        throw fail(HttpStatus.CONFLICT, Code.ROLE_DELETE_IMPACT_CHANGED, 'Deletion impact changed')
      if (!dto.acknowledgeSelfHeld && (await selfHolds(tx, orgId, roleId, principal)))
        throw fail(
          HttpStatus.BAD_REQUEST,
          Code.ROLE_SELF_HELD_ACK_REQUIRED,
          'Acknowledge self-held role'
        )
      const links = await tx.rolePermission.findMany({
        where: { roleId },
        select: { permissionId: true },
      })
      await tx.role.delete({ where: { id: roleId } })
      await collectOrphans(
        tx,
        orgId,
        links.map((link) => link.permissionId)
      )
      const aclVersion = await bumpRevision(tx, orgId, dto.expectedAclVersion)
      const rules = preflight.get(roleId)!
      await recordRoleDefinition(this.audit, tx, 'org.role_deleted', orgId, principal, {
        roleId,
        revisionBefore: dto.expectedAclVersion,
        revisionAfter: aclVersion,
        addedPresetCount: 0,
        removedPresetCount: rules.ruleCount,
        fullControl: fullControlTransition(rules.fullControl, false),
        holderCount: holders,
        liveInvitationCount: live,
        nameChanged: false,
        descriptionChanged: false,
        source: 'editor',
      })
      return { roleId, aclVersion, removedHolderCount: holders, affectedInvitationCount: live }
    })
  }

  /** Build the registry-validated preset selection keyed by `capability:preset`. */
  private desiredPresets(presets: RoleDefinitionPreset[]): Map<string, RoleDefinitionPreset> {
    const desired = new Map<string, RoleDefinitionPreset>()
    for (const preset of presets) {
      this.registry.preset(preset) // CAPABILITY_UNSUPPORTED (400) for an unknown pair
      desired.set(presetKey(preset), preset)
    }
    return desired
  }

  private async detail(
    tx: Tx,
    orgId: string,
    role: Role,
    aclVersion: number,
    principal: RequestPrincipal
  ): Promise<RoleDefinitionDetail> {
    const preflight = (await rulePreflight(tx, [role.id])).get(role.id)!
    return buildRoleDetail(tx, {
      orgId,
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        organizationId: role.organizationId,
      },
      aclVersion,
      actorUserId: principal.sub,
      now: new Date(),
      preflight,
    })
  }

  private assertContext(orgId: string, principal: RequestPrincipal): void {
    if (principal.organizationId !== orgId)
      throw fail(HttpStatus.FORBIDDEN, Code.ROLE_UNAVAILABLE, 'Organization context mismatch')
  }

  /**
   * Transaction runner: deliberate HTTP rejections (400/403/404/409) escape unchanged; only P2034 and
   * the role-name unique violation are mapped, and every other failure is an unconfirmed outcome
   * (503) that is never replayed. The ACL cache invalidation after commit is best effort because the
   * primary organization revision is authoritative.
   */
  private async run<T>(orgId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    let result: T
    try {
      result = await this.prisma.$transaction(work, {
        isolationLevel: 'ReadCommitted',
        maxWait: 2000,
        timeout: 4000,
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      const code = (error as { code?: string } | null)?.code
      if (code === 'P2034') throw conflict()
      if (code === 'P2002')
        throw fail(HttpStatus.CONFLICT, Code.ROLE_NAME_CONFLICT, 'Role name already exists')
      throw fail(
        HttpStatus.SERVICE_UNAVAILABLE,
        Code.ROLE_SAVE_UNAVAILABLE,
        'Role change unconfirmed'
      )
    }
    await this.organizations.invalidateAclVersion(orgId).catch(() => undefined)
    return result
  }
}
