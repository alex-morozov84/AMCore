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

import { Action, type RequestPrincipal, Subject } from '@amcore/shared'

import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { TokenService } from '../auth/token.service'

import { CreateOrganizationDto, UpdateOrganizationDto } from './dto'
import { OrganizationsService } from './organizations.service'

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
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
   */
  @Post(':id/switch')
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
