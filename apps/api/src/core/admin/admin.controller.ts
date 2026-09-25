import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { ZodResponse, ZodValidationException } from 'nestjs-zod'

import {
  ADMIN_ORGANIZATION_SORT_FIELDS,
  ADMIN_USER_SORT_FIELDS,
  adminAuditQuerySchema,
  type AdminAuditResponse,
  adminDetailIdSchema,
  type AdminOrganizationDetailResponse,
  type AdminOrganizationListResponse,
  type AdminOverviewResponse,
  type AdminUserDetailResponse,
  type AdminUserListResponse,
  type AdminUserResponse,
  AuthType,
  PAGINATION,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import type { CleanupResult } from '../../infrastructure/schedule/cleanup.service'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../infrastructure/throttling'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminService } from './admin.service'
import { AdminAuditService } from './admin-audit.service'
import { AdminDetailService } from './admin-detail.service'
import { AdminOverviewService } from './admin-overview.service'
import { AdminAuditResponseDto } from './dto/admin-audit.dto'
import {
  AdminOrganizationDetailQueryDto,
  AdminOrganizationDetailResponseDto,
  AdminUserDetailQueryDto,
  AdminUserDetailResponseDto,
} from './dto/admin-detail.dto'
import { AdminOrganizationListQueryDto } from './dto/admin-organization-list-query.dto'
import { AdminOrganizationListResponseDto } from './dto/admin-organization-response.dto'
import { AdminOverviewResponseDto } from './dto/admin-overview-response.dto'
import { AdminUserListQueryDto } from './dto/admin-user-list-query.dto'
import { AdminUserListResponseDto, AdminUserResponseDto } from './dto/admin-user-response.dto'
import { CleanupResultDto } from './dto/cleanup-result.dto'
import { UpdateSystemRoleDto } from './dto/update-system-role.dto'

/**
 * OA-02: admin routes are bearer-only.
 *
 * `SystemRolesGuard` checks only `request.user.systemRole`, not the
 * credential type or `principal.scopes`. The principal an API key
 * produces inherits `systemRole` from the owning user
 * (`ApiKeyGuard.canActivate` → `apiKey.user.systemRole`), so a
 * SUPER_ADMIN-owned API key with arbitrarily narrow scopes — e.g.
 * `['read:User']` — would otherwise satisfy the system-role check and
 * reach handlers that perform unrestricted Prisma writes. Admin
 * routes also have no `@CheckPolicies`, so the CASL
 * `userPerms ∩ scopes` intersection (AK-09 / Stage 4) is not
 * consulted here at all.
 *
 * `@Auth(AuthType.Bearer)` at the class level short-circuits the
 * auth chain to the JWT branch only; an API key fails the JWT
 * branch as a decision-class 401 (per AK-11 `isDecisionError`).
 *
 * See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-02 and ADR-033.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly overviewService: AdminOverviewService,
    private readonly auditService: AdminAuditService,
    private readonly detailService: AdminDetailService
  ) {}

  @Get('access')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Check Operations Console access — SUPER_ADMIN only' })
  @ApiNoContentResponse({ description: 'Console access granted' })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'SUPER_ADMIN required' })
  checkAccess(): undefined {
    return undefined
  }

  @Get('audit-logs')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit(RATE_LIMIT_POLICIES.AUDIT_READ)
  @ApiOperation({
    summary: 'Browse redacted audit events — live SUPER_ADMIN bearer only',
    description:
      'Newest first within a fixed UTC [from,to) interval. Defaults to 7 days; maximum 31 days. ' +
      'Current names are present-day data and may differ from the event date. ' +
      'Each successful read is durably audited. Invalid or stale cursors require a cursor reset.',
  })
  @ApiQuery({ name: 'actorId', required: false, type: String, maxLength: 128 })
  @ApiQuery({ name: 'actorType', required: false, enum: ['USER', 'API_KEY', 'SYSTEM'] })
  @ApiQuery({ name: 'action', required: false, type: String, maxLength: 96 })
  @ApiQuery({
    name: 'actions',
    required: false,
    type: String,
    maxLength: 969,
    description:
      'Comma-separated list of 1–10 exact action codes; OR semantics. Cannot combine with action.',
  })
  @ApiQuery({ name: 'targetId', required: false, type: String, maxLength: 128 })
  @ApiQuery({ name: 'targetType', required: false, type: String })
  @ApiQuery({ name: 'organizationId', required: false, type: String, maxLength: 128 })
  @ApiQuery({
    name: 'includeReadEvents',
    required: false,
    enum: ['true', 'false'],
    description:
      'Defaults to false; an explicit action or actions selection containing the audit-view code includes matching views',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'UTC ISO lower bound, inclusive',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'UTC ISO upper bound, exclusive; not in future',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 50, example: 25 })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    maxLength: 512,
    description: 'Private sealed cursor; requires the same explicit from/to and filters',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid/repeated query, range, or cursor; reset cursor',
  })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role required' })
  @ApiResponse({ status: 429, description: 'Audit read rate limit exceeded' })
  @ApiResponse({ status: 500, description: 'Audit query or strict read-audit write failed' })
  @ApiResponse({ status: 503, description: 'Audit dependency unavailable' })
  @ZodResponse({
    type: AdminAuditResponseDto,
    status: 200,
    description: 'Redacted events with safe present-day identity projection and opaque cursor',
  })
  listAuditLogs(
    @CurrentUser() actor: RequestPrincipal,
    @Query() rawQuery: Record<string, unknown>
  ): Promise<AdminAuditResponse> {
    // Parse once: the schema transforms action lists and booleans, while the
    // global DTO pipe would re-parse its transformed output and reject it.
    const parsed = adminAuditQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw new ZodValidationException(parsed.error)
    return this.auditService.list(parsed.data, actor)
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users — SUPER_ADMIN only' })
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
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 255,
    description: 'Case-insensitive literal-contains match over name OR email',
  })
  @ApiQuery({ name: 'sortBy', required: false, enum: ADMIN_USER_SORT_FIELDS, example: 'createdAt' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({
    status: 400,
    description:
      'Invalid page/limit/sortBy/sortOrder, an oversized search term, or a repeated query key',
  })
  @ZodResponse({ type: AdminUserListResponseDto, status: 200, description: 'Paginated users' })
  findAllUsers(@Query() query: AdminUserListQueryDto): Promise<AdminUserListResponse> {
    return this.adminService.findAllUsers(query)
  }

  @Get('users/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Inspect one user and paginated organization memberships — SUPER_ADMIN only',
  })
  @ApiParam({ name: 'id', description: 'User CUID or UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 255,
    description: 'Case-insensitive literal-contains match over organization name or slug',
  })
  @ApiResponse({ status: 400, description: 'Invalid user ID, pagination or search' })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role required' })
  @ApiResponse({ status: 404, description: 'User no longer exists' })
  @ApiResponse({ status: 503, description: 'Detail dependency unavailable' })
  @ZodResponse({
    type: AdminUserDetailResponseDto,
    status: 200,
    description: 'Safe user detail and bounded memberships',
  })
  findUserDetail(
    @Param('id') id: string,
    @Query() query: AdminUserDetailQueryDto
  ): Promise<AdminUserDetailResponse> {
    const parsed = adminDetailIdSchema.safeParse(id)
    if (!parsed.success) throw new ZodValidationException(parsed.error)
    return this.detailService.user(parsed.data, query)
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user system role — SUPER_ADMIN only' })
  @ApiParam({ name: 'id', description: 'Target user ID' })
  // OB-06b: destructive privileged op — require a recently re-authenticated
  // session (step-up) on top of the OB-06a current-role check.
  @RequireFreshAuth()
  // OB-03: narrow the global default (100/min) to 20/min for this
  // privileged operation, per-handler. Changing the global DEFAULT policy
  // itself would cap every route in the API at the admin limit (caught in
  // Stage 7 final-e2e).
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiResponse({
    status: 400,
    description: 'BUSINESS_RULE_VIOLATION — self-role-change or demoting the last SUPER_ADMIN',
  })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({
    status: 403,
    description:
      'SUPER_ADMIN required, or STEP_UP_REQUIRED (session not recently re-authenticated)',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded for this privileged operation' })
  @ZodResponse({ type: AdminUserResponseDto, status: 200, description: 'Updated user' })
  updateUserSystemRole(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateSystemRoleDto
  ): Promise<AdminUserResponse> {
    return this.adminService.updateUserSystemRole(id, dto.systemRole, actor)
  }

  @Post('cleanup')
  @ApiOperation({ summary: 'Manually trigger expired records cleanup — SUPER_ADMIN only' })
  // OB-06b: destructive privileged op — require step-up freshness.
  @RequireFreshAuth()
  // OB-03: heavy DB sweep — narrow to 5/min for this handler. Same
  // per-handler-override pattern as above.
  @RateLimit(RATE_LIMIT_POLICIES.EXPENSIVE_ACTION)
  @ZodResponse({ type: CleanupResultDto, status: 200, description: 'Cleanup counts' })
  runCleanup(@CurrentUser() actor: RequestPrincipal): Promise<CleanupResult> {
    return this.adminService.runCleanup(actor)
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations — SUPER_ADMIN only' })
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
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 255,
    description: 'Case-insensitive literal-contains match over name OR slug',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ADMIN_ORGANIZATION_SORT_FIELDS,
    example: 'createdAt',
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({
    status: 400,
    description:
      'Invalid page/limit/sortBy/sortOrder, an oversized search term, or a repeated query key',
  })
  @ZodResponse({
    type: AdminOrganizationListResponseDto,
    status: 200,
    description: 'Paginated organizations',
  })
  findAllOrganizations(
    @Query() query: AdminOrganizationListQueryDto
  ): Promise<AdminOrganizationListResponse> {
    return this.adminService.findAllOrganizations(query)
  }

  @Get('organizations/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Inspect one organization and searchable paginated members — SUPER_ADMIN only',
  })
  @ApiParam({ name: 'id', description: 'Organization CUID or UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 255,
    description: 'Case-insensitive literal-contains match over member name or email',
  })
  @ApiResponse({ status: 400, description: 'Invalid organization ID, pagination or search' })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Organization no longer exists' })
  @ApiResponse({ status: 503, description: 'Detail dependency unavailable' })
  @ZodResponse({
    type: AdminOrganizationDetailResponseDto,
    status: 200,
    description: 'Safe organization detail and bounded members',
  })
  findOrganizationDetail(
    @Param('id') id: string,
    @Query() query: AdminOrganizationDetailQueryDto
  ): Promise<AdminOrganizationDetailResponse> {
    const parsed = adminDetailIdSchema.safeParse(id)
    if (!parsed.success) throw new ZodValidationException(parsed.error)
    return this.detailService.organization(parsed.data, query)
  }

  @Get('overview')
  @ApiOperation({ summary: 'Console Overview status — SUPER_ADMIN only' })
  @ZodResponse({
    type: AdminOverviewResponseDto,
    status: 200,
    description:
      'This API instance’s readiness, dependency states, version and process role. ' +
      'Always 200 even when the instance is not ready (see `readiness`); an HTTP 5xx here ' +
      'means the observation itself failed, not that the instance is unhealthy.',
  })
  @ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
  @ApiResponse({ status: 403, description: 'SUPER_ADMIN required' })
  @ApiResponse({
    status: 503,
    description:
      'The observation itself could not be completed (e.g. the request timed out or the ' +
      'service was otherwise unreachable) — distinct from the typed 200 `readiness: ' +
      "'not_ready'` response, which means the observation succeeded and found this " +
      'instance degraded.',
  })
  getOverview(): Promise<AdminOverviewResponse> {
    return this.overviewService.getOverview()
  }
}
