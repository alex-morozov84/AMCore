import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { ZodResponse } from 'nestjs-zod'

import { type AcceptInviteResponse, AuthType, type RequestPrincipal } from '@amcore/shared'

import { getClientIp } from '../../common/utils/anonymize-ip'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { AcceptInviteDto, AcceptInviteResponseDto } from './dto'
import { InviteService } from './invite.service'

/**
 * Invite-accept HTTP surface (OB-02 Stage C).
 *
 * Route prefix is `auth/invites` even though this controller lives in
 * `OrganizationsModule`. Hosting it here avoids a circular dependency
 * between `AuthModule` and `OrganizationsModule` — `InviteService`
 * depends on `OrganizationsService` (for `bumpAclVersionTx` /
 * `invalidateAclVersion`), which itself depends on `AuthModule`
 * providers (`TokenService`, `UserCacheService`, etc.). Moving this
 * controller into `AuthModule` would invert that direction. The URL
 * sits under `/auth/` purely for caller-facing grouping (accept is an
 * identity-bound action, not an org-context action — no `/switch`
 * required).
 *
 * Class-level `@Auth(AuthType.Bearer)` — bearer-only. Accepting an
 * invite must be performed by the human owner of the canonical email;
 * a long-lived API key would defeat the email-ownership proof. Adding
 * `AuthType.ApiKey` here requires an ADR-034 amendment and a per-
 * handler allowlist entry.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/invites')
@Auth(AuthType.Bearer)
export class AuthInvitesController {
  constructor(private readonly inviteService: InviteService) {}

  @Post('accept')
  @ZodResponse({ type: AcceptInviteResponseDto, status: 200, description: 'Invite accepted' })
  @ApiOperation({
    summary:
      'Accept a pending invite using the raw invite token from the invite ' +
      'email. The authenticated user must own the canonical email the ' +
      'invite was issued for and must have a verified email address. On ' +
      'success creates the org membership and returns { organizationId, ' +
      'roleId }. Negative paths (token missing / expired / revoked / ' +
      'already accepted / email mismatch) all return 400 with errorCode ' +
      'INVITE_INVALID_OR_EXPIRED.',
  })
  accept(
    @Body() dto: AcceptInviteDto,
    @CurrentUser() principal: RequestPrincipal,
    @Req() req: Request
  ): Promise<AcceptInviteResponse> {
    const ip = getClientIp(req) ?? 'unknown'
    return this.inviteService.acceptInvite(dto.token, principal, ip)
  }
}
