import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import {
  AuthType,
  type NotificationCapabilitiesResponse,
  type NotificationPreferencesResponse,
} from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'

import {
  NotificationCapabilitiesResponseDto,
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferenceDto,
  UpdateNotificationSettingsDto,
} from './dto/notification.dto.js'
import { NotificationPreferenceService } from './notification-preference.service.js'

/**
 * Notification preferences, capabilities, and the master toggle (Arc A.6),
 * bearer-authenticated and scoped to the caller.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('notifications')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get('capabilities')
  @ApiOperation({ summary: 'Active channels and per-category capabilities' })
  @SchemaResponse({
    type: NotificationCapabilitiesResponseDto,
    status: 200,
    description: 'Notification capabilities',
  })
  getCapabilities(): NotificationCapabilitiesResponse {
    return this.preferences.getCapabilities()
  }

  @Get('preferences')
  @ApiOperation({ summary: 'User notification preferences and master toggle' })
  @SchemaResponse({
    type: NotificationPreferencesResponseDto,
    status: 200,
    description: 'Notification preferences',
  })
  getPreferences(@CurrentUser('sub') userId: string): Promise<NotificationPreferencesResponse> {
    return this.preferences.getPreferences(userId)
  }

  @Put('preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set one (category, channel) preference' })
  @ApiNoContentResponse({ description: 'Preference updated' })
  async updatePreference(
    @CurrentUser('sub') userId: string,
    @Body({ schema: UpdateNotificationPreferenceDto.schema }) body: UpdateNotificationPreferenceDto
  ): Promise<void> {
    await this.preferences.updatePreference(userId, body)
  }

  @Patch('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set the master notifications toggle' })
  @ApiNoContentResponse({ description: 'Master toggle updated' })
  async updateSettings(
    @CurrentUser('sub') userId: string,
    @Body({ schema: UpdateNotificationSettingsDto.schema }) body: UpdateNotificationSettingsDto
  ): Promise<void> {
    await this.preferences.setMasterToggle(userId, body.notificationsEnabled)
  }
}
