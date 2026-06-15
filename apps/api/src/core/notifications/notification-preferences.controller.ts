import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  type NotificationCapabilitiesResponse,
  type NotificationPreferencesResponse,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import {
  NotificationCapabilitiesResponseDto,
  NotificationPreferencesResponseDto,
  UpdateNotificationPreferenceDto,
  UpdateNotificationSettingsDto,
} from './dto/notification.dto'
import { NotificationPreferenceService } from './notification-preference.service'

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
  @ZodResponse({
    type: NotificationCapabilitiesResponseDto,
    status: 200,
    description: 'Notification capabilities',
  })
  getCapabilities(): NotificationCapabilitiesResponse {
    return this.preferences.getCapabilities()
  }

  @Get('preferences')
  @ApiOperation({ summary: 'User notification preferences and master toggle' })
  @ZodResponse({
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
    @Body() body: UpdateNotificationPreferenceDto
  ): Promise<void> {
    await this.preferences.updatePreference(userId, body)
  }

  @Patch('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set the master notifications toggle' })
  @ApiNoContentResponse({ description: 'Master toggle updated' })
  async updateSettings(
    @CurrentUser('sub') userId: string,
    @Body() body: UpdateNotificationSettingsDto
  ): Promise<void> {
    await this.preferences.setMasterToggle(userId, body.notificationsEnabled)
  }
}
