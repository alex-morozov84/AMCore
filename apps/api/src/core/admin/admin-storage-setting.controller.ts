import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  type RequestPrincipal,
  type StorageProbeSettingResponse,
  SystemRole,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminStorageSettingService } from './admin-storage-setting.service'
import {
  StorageProbeSettingResponseDto,
  StorageProbeSettingUpdateDto,
} from './dto/storage-probe-setting.dto'
import { PlatformSettingsPrincipalGuard } from './platform-settings-principal.guard'

import { RATE_LIMIT_POLICIES, RateLimit } from '@/infrastructure/throttling'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@UseGuards(PlatformSettingsPrincipalGuard)
@ApiResponse({ status: 401, description: 'Personal bearer JWT required; API keys rejected' })
@ApiResponse({
  status: 403,
  description: 'Current SUPER_ADMIN required; writes require fresh auth',
})
@ApiResponse({ status: 503, description: 'Authoritative settings read unavailable' })
@Controller('admin/runtime-settings/storage-probe')
export class AdminStorageSettingController {
  constructor(private readonly settings: AdminStorageSettingService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read saved interval and responding API applied state; not fleet confirmation',
  })
  @ZodResponse({
    type: StorageProbeSettingResponseDto,
    status: 200,
    description: 'Saved and applied state separately',
  })
  get(): Promise<StorageProbeSettingResponse> {
    return this.settings.get()
  }

  @Patch()
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({ summary: 'Save interval; null resets to each process deployment baseline' })
  @ApiResponse({
    status: 400,
    description: 'Strict body: integer 30–3600 or null and expectedRevision',
  })
  @ApiResponse({
    status: 409,
    description: 'SETTING_REVISION_CONFLICT; reread before explicit save',
  })
  @ApiResponse({ status: 429, description: 'Privileged write rate exceeded' })
  @ApiResponse({ status: 500, description: 'Write or atomic audit failed; no success receipt' })
  @ZodResponse({
    type: StorageProbeSettingResponseDto,
    status: 200,
    description: 'Committed saved state; runtime adoption may lag',
  })
  update(
    @Body() input: StorageProbeSettingUpdateDto,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<StorageProbeSettingResponse> {
    return this.settings.update(input, actor)
  }
}
