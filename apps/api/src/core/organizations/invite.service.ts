import { Injectable } from '@nestjs/common'

import type {
  AcceptIntent,
  CreateInviteInput,
  InviteListQuery,
  InviteRoleChoicesQuery,
  ReissueInviteInput,
  RequestPrincipal,
} from '@amcore/shared'

import type { InvitationCredential } from '../invitations/invitation-credential'

import type { InvitationActor } from './invitation-actor'
import { InvitationCommandService } from './invitation-command.service'
import { InvitationQueryService } from './invitation-query.service'
import { InviteAcceptService } from './invite-accept.service'
import { InviteRevokeService } from './invite-revoke.service'

/** Public application facade; each lifecycle responsibility has its own service. */
@Injectable()
export class InviteService {
  constructor(
    private readonly command: InvitationCommandService,
    private readonly query: InvitationQueryService,
    private readonly acceptance: InviteAcceptService,
    private readonly revocation: InviteRevokeService
  ) {}

  createInvite(
    orgId: string,
    dto: CreateInviteInput,
    actor: InvitationActor,
    operationId: string
  ): ReturnType<InvitationCommandService['execute']> {
    return this.command.execute(orgId, { kind: 'create', dto }, actor, operationId)
  }
  reissueInvite(
    orgId: string,
    id: string,
    dto: ReissueInviteInput,
    actor: InvitationActor,
    operationId: string
  ): ReturnType<InvitationCommandService['execute']> {
    return this.command.execute(orgId, { kind: 'reissue', id, dto }, actor, operationId)
  }
  listInvites(
    orgId: string,
    actor: InvitationActor,
    query: InviteListQuery
  ): ReturnType<InvitationQueryService['list']> {
    return this.query.list(orgId, actor, query)
  }
  roleChoices(
    orgId: string,
    actor: InvitationActor,
    query: InviteRoleChoicesQuery
  ): ReturnType<InvitationQueryService['choices']> {
    return this.query.choices(orgId, actor, query)
  }
  managerOperation(
    orgId: string,
    actor: InvitationActor,
    operationId: string
  ): ReturnType<InvitationQueryService['operation']> {
    return this.query.operation(orgId, actor, operationId)
  }
  revokeInvite(
    orgId: string,
    id: string,
    generation: number,
    actor: InvitationActor,
    operationId: string
  ): ReturnType<InviteRevokeService['revoke']> {
    return this.revocation.revoke(orgId, id, generation, actor, operationId)
  }
  acceptInvite(
    credential: InvitationCredential,
    intent: AcceptIntent,
    operationId: string,
    principal: RequestPrincipal,
    ip: string
  ): ReturnType<InviteAcceptService['accept']> {
    return this.acceptance.accept(credential, intent, operationId, principal, ip)
  }
}
