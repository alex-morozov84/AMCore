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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import type { OrganizationContextResponse } from '@amcore/shared'
import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
  type OrganizationListResponse,
  type OrgResponse,
  PAGINATION,
  type RequestPrincipal,
  type SwitchOrgResponse,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import type { AppAbility } from '../auth/casl/ability.factory'
import type { TeamAccessDecision } from '../auth/casl/ability.factory'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentAbility } from '../auth/decorators/current-ability.decorator'
import { CurrentTeamAccess } from '../auth/decorators/current-team-access.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'
import {
  CurrentOrganizationContext,
  type VerifiedOrganizationContext,
} from '../auth/organization-context/verified-organization-context'
import { TokenService } from '../auth/token.service'

import {
  CreateOrganizationDto,
  OrgResponseDto,
  SwitchOrgResponseDto,
  UpdateOrganizationDto,
} from './dto'
import { OrganizationContextResponseDto } from './dto/organization-context-response.dto'
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
 *
 * `@ApiSecurity('apiKeyBearer')` (the Swagger-visible counterpart of the
 * ADR-034 allowlist) is applied per-handler, never at class level:
 * `@nestjs/swagger` concatenates class- and method-level `security`
 * arrays rather than letting a method override the class, so a
 * class-level `@ApiSecurity` would incorrectly leak onto `create`,
 * `findAll`, and `switchOrganization` below despite their handler-level
 * `@Auth(AuthType.Bearer)` override.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid accepted credential' })
@Controller('organizations')
@Auth(AuthType.Bearer, AuthType.ApiKey)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
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
  @ZodResponse({ type: OrgResponseDto, status: 201, description: 'Organization created' })
  @RequestContextPolicy({ kind: 'personal' })
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser('sub') userId: string
  ): Promise<OrgResponse> {
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
  @ZodResponse({
    type: OrganizationListResponseDto,
    status: 200,
    description: 'Paginated organizations',
  })
  @RequestContextPolicy({ kind: 'discovery' })
  findAll(
    @CurrentUser('sub') userId: string,
    @Query() pagination: PaginationQueryDto
  ): Promise<OrganizationListResponse> {
    return this.orgsService.findAllForUser(userId, pagination.page, pagination.limit)
  }

  /**
   * OA-03: dual-auth, but API keys are constrained on two axes
   * (`principal.organizationId === :id` AND
   * `read` on the actual organization and every returned field). The first axis is the
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
  @ApiForbiddenResponse({ description: 'FORBIDDEN: organization access denied' })
  @ApiNotFoundResponse({ description: 'Organization missing or caller is not a member' })
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({
    summary: 'Get organization details (must be a member)',
    description:
      'JWT: membership-based discovery without switching organization context. API key: bound organization, actual record conditions and read permission for all six response fields; partial grants return 403.',
  })
  @ZodResponse({ type: OrgResponseDto, status: 200, description: 'Organization details' })
  @RequestContextPolicy({ kind: 'discovery' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() principal: RequestPrincipal,
    @CurrentAbility() ability: AppAbility
  ): Promise<OrgResponse> {
    return this.orgsService.findOne(id, principal, ability)
  }

  @Get(':id/context')
  @Auth(AuthType.Bearer)
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'id' }, concealMissing: true })
  @ApiOperation({
    summary: 'Read selected organization context using a personal JWT',
    description:
      'Requires current membership even for a platform administrator. Affordances do not grant authority to later operations.',
  })
  @ApiNotFoundResponse({ description: 'Organization missing or caller is not a member' })
  @ApiForbiddenResponse({ description: 'Bound credential organization does not match target' })
  @ZodResponse({
    type: OrganizationContextResponseDto,
    status: 200,
    description: 'Safe organization context',
  })
  selectedContext(
    @CurrentOrganizationContext() context: VerifiedOrganizationContext,
    @CurrentTeamAccess() access: TeamAccessDecision,
    @CurrentAbility() ability: AppAbility
  ): Promise<OrganizationContextResponse> {
    return this.orgsService.selectedContext(context, access, ability)
  }

  @Patch(':id')
  @ApiForbiddenResponse({ description: 'FORBIDDEN: organization access denied' })
  @ApiNotFoundResponse({ description: 'Organization missing' })
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({
    summary:
      'Update selected organization fields — current authority and full response read required',
  })
  @ZodResponse({ type: OrgResponseDto, status: 200, description: 'Updated organization' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'id' },
    legacyPlatformMembershipBypass: true,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() principal: RequestPrincipal,
    @CurrentAbility() ability: AppAbility
  ): Promise<OrgResponse> {
    return this.orgsService.update(id, principal, dto, ability)
  }

  @Delete(':id')
  @ApiForbiddenResponse({ description: 'FORBIDDEN: organization access denied' })
  @ApiNotFoundResponse({ description: 'Organization missing' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('id')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({
    summary:
      'Delete organization — full TeamAccess and delete on every organization field required',
  })
  @ApiNoContentResponse({ description: 'Organization deleted' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'id' },
    legacyPlatformMembershipBypass: true,
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() principal: RequestPrincipal,
    @CurrentAbility() ability: AppAbility
  ): Promise<void> {
    return this.orgsService.remove(id, principal, ability)
  }

  /**
   * Returns a new access token with this organization's context (organizationId + aclVersion).
   * Client should replace the current access token with the returned one.
   * Retained exchange for direct clients. Personal JWT organization operations select their target explicitly.
   *
   * OA-01: bearer-only. An API key must never be convertible into a JWT —
   * doing so would let a narrowly-scoped integration credential mint a
   * full-permission token for the owner, bypassing the
   * `userPerms ∩ scopes` invariant from ADR-033, and could even cross
   * organizations the API key is not bound to (the handler trusts only
   * `user.sub` here). See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-01.
   */
  @Post(':id/switch')
  @ApiForbiddenResponse({ description: 'FORBIDDEN: organization access denied' })
  @Auth(AuthType.Bearer)
  @ApiOperation({
    summary: 'Get JWT with this organization context — must be a member',
    description:
      'The derived token expires no later than its parent. Repeated exchanges do not renew access. Membership-checked exchange between organizations remains supported.',
  })
  @ApiUnauthorizedResponse({
    description: 'UNAUTHORIZED: invalid credential or missing/elapsed parent expiry',
  })
  @ZodResponse({ type: SwitchOrgResponseDto, status: 200, description: 'Org-context access token' })
  @RequestContextPolicy({ kind: 'exchange' })
  async switchOrganization(
    @Param('id') orgId: string,
    @CurrentUser() user: RequestPrincipal
  ): Promise<SwitchOrgResponse> {
    const { aclVersion } = await this.orgsService.getForSwitch(orgId, user.sub)
    const accessToken = this.tokenService.generateDerivedAccessToken(
      {
        sub: user.sub,
        email: user.email ?? '',
        systemRole: user.systemRole,
        organizationId: orgId,
        aclVersion,
        // Preserve the session id so an org-context token keeps step-up
        // capability (OB-06b) — without it a switched token looks legacy and
        // fails closed on @RequireFreshAuth routes.
        sid: user.sid,
      },
      user.exp
    )
    return { accessToken }
  }
}
