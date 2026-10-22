import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  type CreateInviteInput,
  InviteErrorCode,
  type InviteResponse,
  type ReissueInviteInput,
} from '@amcore/shared'

import { ForbiddenException, NotFoundException } from '../../common/exceptions/index.js'
import { AuditActorType, AuditTargetType, type Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import { AuditLogService } from '../audit/index.js'
import { EmailIdentityService } from '../auth/email-identity.service.js'
import { issueInvitation } from '../invitations/invitation-issuance.js'
import {
  currentInvitationIntent,
  invitationDefaultRole,
  lockInvitationRoles,
} from '../invitations/invitation-role-intent.js'
import { rejectManagedInvitation } from '../invitations/provisioning-settlement.js'

import { assertInvitationActor, type InvitationActor } from './invitation-actor.js'
import { InvitationAuthorization } from './invitation-authorization.js'
import { InvitationEmailService, type InvitationMailSnapshot } from './invitation-email.service.js'
import { invitationClock, lockInvitation, lockInvitationOrg } from './invitation-locks.js'
import {
  completeInvitationOperation,
  INVITATION_RETENTION_MS,
  invitationConflict,
  invitationFingerprint,
  lockInvitationOperation,
  replayInvitationOperation,
} from './invitation-operation.js'
import { invitationPostCommit } from './invitation-post-commit.js'
import { invitationTransaction } from './invitation-transaction.js'
import { InviteRateLimiterService } from './invite-rate-limiter.service.js'

const ack: InviteResponse = { status: 'invited' }
type Mail = Omit<InvitationMailSnapshot, 'orgName' | 'inviterName' | 'inviterEmail'> & {
  email: string
  token: string
  roleNames: string[]
  locale: string | null
  hasAccount: boolean
}
type Command =
  | { kind: 'create'; dto: CreateInviteInput }
  | { kind: 'reissue'; id: string; dto: ReissueInviteInput }

@Injectable()
export class InvitationCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: InvitationAuthorization,
    private readonly emailIdentity: EmailIdentityService,
    private readonly limiter: InviteRateLimiterService,
    private readonly audit: AuditLogService,
    private readonly email: InvitationEmailService
  ) {}

  async execute(
    orgId: string,
    command: Command,
    actor: InvitationActor,
    operationId: string
  ): Promise<InviteResponse> {
    assertInvitationActor(actor)
    if (actor.principal.type !== 'jwt' || actor.principal.organizationId !== orgId)
      throw new ForbiddenException()
    const canonical =
      command.kind === 'create' ? this.emailIdentity.canonicalize(command.dto.email) : undefined
    const intent = this.intent(command, canonical)
    const mail = await invitationTransaction(this.prisma, async (tx) => {
      const receipt = await lockInvitationOperation(tx, actor.principal.sub, orgId, operationId)
      const user = await this.authorization.lockActor(tx, actor)
      if (canonical)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`org-invite:${orgId}:${canonical}`}, 0)::bigint)`
      await lockInvitationOrg(tx, orgId)
      await this.authorization.authorize(tx, orgId, actor, user)
      const replay = await replayInvitationOperation(
        tx,
        receipt,
        operationId,
        invitationFingerprint(intent)
      )
      if (replay !== undefined) return null
      await rejectManagedInvitation(
        tx,
        orgId,
        command.kind === 'create' ? { email: canonical! } : { id: command.id }
      )
      const result =
        command.kind === 'create'
          ? await this.create(tx, orgId, command.dto, canonical!, actor)
          : await this.reissue(tx, orgId, command.id, command.dto, actor)
      await completeInvitationOperation(tx, {
        actorId: user.id,
        organizationId: orgId,
        scope: orgId,
        operationId,
        kind: command.kind,
        intent,
        result: ack,
      })
      if (!result) return null
      // These parents are already locked; no postcommit metadata lookup or fictional fallback.
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { name: true },
      })
      const inviter = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true, email: true },
      })
      return {
        ...result,
        orgName: organization.name,
        inviterName: inviter.name ?? inviter.email,
        inviterEmail: inviter.email,
      }
    })
    if (mail) {
      const outcome = await invitationPostCommit(() => this.email.dispatch(mail))
      if (outcome) this.email.reportOutcome(orgId, outcome)
    }
    return ack
  }

  private intent(command: Command, email: string | undefined): Prisma.InputJsonValue {
    if (command.kind === 'create')
      return {
        kind: 'create',
        email: email!,
        roleSelection: command.dto.roleIds
          ? { kind: 'explicit', ids: [...command.dto.roleIds].sort() }
          : { kind: 'default-member' },
      }
    return {
      kind: 'reissue',
      id: command.id,
      expectedGeneration: command.dto.expectedGeneration,
      mode: command.dto.mode,
      ...(command.dto.mode === 'replace' ? { roleIds: [...command.dto.roleIds].sort() } : {}),
    }
  }

  private async create(
    tx: Prisma.TransactionClient,
    orgId: string,
    dto: CreateInviteInput,
    canonical: string,
    actor: InvitationActor
  ): Promise<Mail | null> {
    const roles = await lockInvitationRoles(
      tx,
      dto.roleIds ?? [(await invitationDefaultRole(tx)).id],
      orgId
    )
    await this.limiter.consume(orgId, canonical, actor.principal.sub)
    const target = await tx.user.findUnique({
      where: { emailCanonical: canonical },
      select: { id: true, locale: true },
    })
    const member =
      target &&
      (await tx.orgMember.findUnique({
        where: { userId_organizationId: { userId: target.id, organizationId: orgId } },
        select: { id: true },
      }))
    if (member) {
      await this.record(tx, orgId, actor, undefined, canonical, 'noop_already_member', [])
      return null
    }
    const pending = await tx.orgInvite.findFirst({
      where: {
        organizationId: orgId,
        emailCanonical: canonical,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    })
    let now = await invitationClock(tx)
    if (pending) {
      const locked = await lockInvitation(tx, pending.id, orgId)
      now = await invitationClock(tx)
      if (locked && locked.expiresAt.getTime() + INVITATION_RETENTION_MS > now.getTime())
        throw invitationConflict(InviteErrorCode.INVITE_ALREADY_PENDING)
      if (locked) await tx.orgInvite.delete({ where: { id: locked.id } })
    }
    const row = await issueInvitation(tx, {
      frontend: this.email.destination(),
      organizationId: orgId,
      email: dto.email,
      emailCanonical: canonical,
      actorId: actor.principal.sub,
      roles,
      now,
    })
    const token = row.token
    await this.record(
      tx,
      orgId,
      actor,
      row.id,
      canonical,
      'created',
      roles.map((r) => r.id)
    )
    return {
      email: dto.email,
      token,
      roleNames: roles.map((r) => r.name),
      locale: target?.locale ?? null,
      hasAccount: !!target,
    }
  }

  private async reissue(
    tx: Prisma.TransactionClient,
    orgId: string,
    id: string,
    dto: ReissueInviteInput,
    actor: InvitationActor
  ): Promise<Mail> {
    const hint = await tx.orgInvite.findFirst({
      where: { id, organizationId: orgId },
      select: { generation: true, acceptedAt: true, revokedAt: true },
    })
    if (!hint) throw new NotFoundException('Invitation')
    if (hint.generation !== dto.expectedGeneration)
      throw invitationConflict(InviteErrorCode.INVITE_GENERATION_CONFLICT)
    if (hint.acceptedAt || hint.revokedAt) throw invitationConflict(InviteErrorCode.INVITE_SETTLED)
    // Org lock excludes role deletion; ordered role locks precede the invite lock.
    const roles =
      dto.mode === 'replace'
        ? await lockInvitationRoles(tx, dto.roleIds, orgId)
        : await currentInvitationIntent(tx, id, orgId)
    const invite = await lockInvitation(tx, id, orgId)
    if (!invite) throw new NotFoundException('Invitation')
    if (invite.generation !== dto.expectedGeneration)
      throw invitationConflict(InviteErrorCode.INVITE_GENERATION_CONFLICT)
    if (invite.acceptedAt || invite.revokedAt)
      throw invitationConflict(InviteErrorCode.INVITE_SETTLED)
    const now = await invitationClock(tx)
    if (invite.expiresAt.getTime() + INVITATION_RETENTION_MS <= now.getTime())
      throw new NotFoundException('Invitation')
    if (dto.mode === 'repeat' && invite.intentInvalid)
      throw invitationConflict(InviteErrorCode.INVITE_ROLE_INTENT_INVALID)
    if (invite.generation === 2_147_483_647)
      throw invitationConflict(InviteErrorCode.INVITE_GENERATION_CONFLICT)
    await this.limiter.consume(orgId, invite.emailCanonical, actor.principal.sub)
    const { token } = await issueInvitation(tx, {
      frontend: this.email.destination(),
      organizationId: orgId,
      email: invite.email,
      emailCanonical: invite.emailCanonical,
      actorId: actor.principal.sub,
      roles,
      now,
      current: invite,
    })
    await this.record(
      tx,
      orgId,
      actor,
      id,
      invite.emailCanonical,
      'reissued',
      roles.map((r) => r.id)
    )
    const target = await tx.user.findUnique({
      where: { emailCanonical: invite.emailCanonical },
      select: { locale: true },
    })
    return {
      email: invite.email,
      token,
      roleNames: roles.map((r) => r.name),
      locale: target?.locale ?? null,
      hasAccount: !!target,
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    orgId: string,
    actor: InvitationActor,
    id: string | undefined,
    canonical: string,
    branch: string,
    roleIds: string[]
  ): Promise<void> {
    await this.audit.record(
      {
        action: branch === 'reissued' ? 'org.invite_reissued' : 'org.invite_created',
        actorId: actor.principal.sub,
        actorType: AuditActorType.USER,
        organizationId: orgId,
        targetId: id,
        targetType: AuditTargetType.ORG_INVITE,
        metadata: {
          actorCredentialType: actor.principal.type,
          branch,
          emailHash: this.hash(canonical),
          roleIds,
        },
      },
      { tx }
    )
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
