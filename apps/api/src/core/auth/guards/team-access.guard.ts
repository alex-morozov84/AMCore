import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions'
import { PrismaService } from '../../../prisma'
import type { TeamAccessDecision } from '../casl/ability.factory'
import { TEAM_ACCESS_KEY } from '../decorators/require-team-access.decorator'

@Injectable()
export class TeamAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const param = this.reflector.getAllAndOverride<string>(TEAM_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (param === undefined) return true
    const request = context.switchToHttp().getRequest<{
      user?: RequestPrincipal
      teamAccess?: TeamAccessDecision
      params: Record<string, string>
    }>()
    const actor = request.user
    const decision = request.teamAccess
    const orgId = request.params[param]
    if (
      !actor ||
      !decision ||
      !orgId ||
      actor.organizationId !== orgId ||
      decision.organizationId !== orgId ||
      decision.actorId !== actor.sub ||
      decision.type !== actor.type ||
      (actor.type === 'api_key' && decision.aclVersion !== actor.aclVersion) ||
      !decision.ownerTrusted ||
      !decision.credentialTrusted
    ) {
      throw new ForbiddenException('Full team access is required for this organization')
    }
    if (actor.type === 'jwt' && actor.systemRole !== SystemRole.SuperAdmin) {
      const member = await this.prisma.orgMember.findUnique({
        where: { userId_organizationId: { userId: actor.sub, organizationId: orgId } },
        select: { id: true },
      })
      if (!member) throw new ForbiddenException('Organization membership is required')
    }
    return true
  }
}
