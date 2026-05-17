import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Organization } from '@prisma/client'

import { Action, AuthType, type RequestPrincipal, Subject } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { TokenService } from '../auth/token.service'

import { CreateOrganizationDto, UpdateOrganizationDto } from './dto'
import { OrganizationsService } from './organizations.service'

/**
 * Class-level `@Auth(AuthType.Bearer, AuthType.ApiKey)` is an explicit
 * dual-auth opt-in registered in ADR-034's allowlist (runtime default
 * after Stage 1c is `[AuthType.Bearer]` — every ApiKey acceptance is
 * explicit). Per-handler overrides apply via
 * `reflector.getAllAndOverride([handler, class])`: `switchOrganization`
 * carries `@Auth(AuthType.Bearer)` because it mints a JWT (OA-01).
 *
 * The ADR-034 allowlist in `auth-decorator-coverage.spec.ts` enumerates
 * each ApiKey-accepting handler in this controller individually — a new
 * handler added here inherits the class annotation but must also be
 * added to the allowlist (via ADR amendment) for the metadata test to
 * pass. See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
@Auth(AuthType.Bearer, AuthType.ApiKey)
export class OrganizationsController {
  constructor(
    private readonly orgsService: OrganizationsService,
    private readonly tokenService: TokenService
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization — caller becomes ADMIN' })
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser('sub') userId: string
  ): Promise<Organization> {
    return this.orgsService.create(userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations the current user belongs to' })
  findAll(@CurrentUser('sub') userId: string): Promise<Organization[]> {
    return this.orgsService.findAllForUser(userId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization details (must be a member)' })
  findOne(@Param('id') id: string, @CurrentUser('sub') userId: string): Promise<Organization> {
    return this.orgsService.findOne(id, userId)
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Update organization — ADMIN only, requires org context in JWT' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<Organization> {
    return this.orgsService.update(id, principal, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Delete organization — ADMIN only, requires org context in JWT' })
  remove(@Param('id') id: string, @CurrentUser() principal: RequestPrincipal): Promise<void> {
    return this.orgsService.remove(id, principal)
  }

  /**
   * Returns a new access token with this organization's context (organizationId + aclVersion).
   * Client should replace the current access token with the returned one.
   * Org context is required for ADMIN operations and CASL permission evaluation.
   *
   * OA-01: bearer-only. An API key must never be convertible into a JWT —
   * doing so would let a narrowly-scoped integration credential mint a
   * full-permission token for the owner, bypassing the
   * `userPerms ∩ scopes` invariant from ADR-033, and could even cross
   * organizations the API key is not bound to (the handler trusts only
   * `user.sub` here). See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-01.
   */
  @Post(':id/switch')
  @Auth(AuthType.Bearer)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get new JWT with this organization context — must be a member' })
  async switchOrganization(
    @Param('id') orgId: string,
    @CurrentUser() user: RequestPrincipal
  ): Promise<{ accessToken: string }> {
    const { aclVersion } = await this.orgsService.getForSwitch(orgId, user.sub)
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.sub,
      email: user.email ?? '',
      systemRole: user.systemRole,
      organizationId: orgId,
      aclVersion,
    })
    return { accessToken }
  }
}
