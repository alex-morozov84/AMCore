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
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import type { Organization } from '@prisma/client'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  Action,
  AuthType,
  type OrganizationListResponse,
  PAGINATION,
  type RequestPrincipal,
  Subject,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import type { AppAbility } from '../auth/casl/ability.factory'
import { Auth } from '../auth/decorators/auth.decorator'
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentAbility } from '../auth/decorators/current-ability.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { TokenService } from '../auth/token.service'

import { CreateOrganizationDto, UpdateOrganizationDto } from './dto'
import { OrganizationListResponseDto } from './dto/organization-list-response.dto'
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

  /**
   * OA-03: JWT-only. Creating a new organization makes the caller an
   * ADMIN of a brand-new org. An API key bound to org A would otherwise
   * be able to spin up org C where the owner is ADMIN — cross-org
   * expansion through an integration credential. Org creation is an
   * interactive-session decision; integrations should never need it.
   */
  @Post()
  @Auth(AuthType.Bearer)
  @ApiOperation({ summary: 'Create a new organization — caller becomes ADMIN' })
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser('sub') userId: string
  ): Promise<Organization> {
    return this.orgsService.create(userId, dto)
  }

  /**
   * OA-03: JWT-only. Listing all organizations the owner belongs to
   * leaks org-membership topology beyond the API key's bound org —
   * a scoped key for org A would return B, C, and any other org the
   * owner is in. Org discovery is interactive UI; integrations get
   * their org via the key's bound `organizationId`.
   */
  @Get()
  @Auth(AuthType.Bearer)
  @ApiOperation({ summary: 'List all organizations the current user belongs to' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    example: PAGINATION.DEFAULT_PAGE,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    example: PAGINATION.DEFAULT_LIMIT,
  })
  @ZodSerializerDto(OrganizationListResponseDto)
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() pagination: PaginationQueryDto
  ): Promise<OrganizationListResponse> {
    return this.orgsService.findAllForUser(userId, pagination.page, pagination.limit)
  }

  /**
   * OA-03: dual-auth, but API keys are constrained on two axes
   * (`principal.organizationId === :id` AND
   * `ability.can(Read, Organization)`). The first axis is the
   * bound-org boundary; the second is the `userPerms ∩ scopes`
   * invariant from ADR-033 — a scoped key with e.g. `read:User` must
   * not be able to read the org record. JWT principals follow the
   * existing membership check — read does not require `/switch`,
   * otherwise the UI would face a chicken-and-egg "switch before you
   * can choose an org" cycle, AND a JWT without org-context has an
   * empty personal ability that would block all reads if we applied
   * the same ability check uniformly. Discrimination lives in the
   * service so the rule sits next to the business logic.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get organization details (must be a member)' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() principal: RequestPrincipal,
    @CurrentAbility() ability: AppAbility
  ): Promise<Organization> {
    return this.orgsService.findOne(id, principal, ability)
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
