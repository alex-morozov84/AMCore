import { Controller, Get, Req } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import type { z } from 'zod'

import { AuthType, mfaSettingsViewSchema, type RequestPrincipal } from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions/index.js'
import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { PrismaService } from '../../prisma/index.js'

import { Auth } from './decorators/auth.decorator.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import { accountRequiresMfa } from './mfa/mfa-account-policy.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

const SettingsResult = createSchemaDto(mfaSettingsViewSchema, 'MfaSettingsResult')

/** Ordinary admission precedes this nonsecret view; only operators can start initial enrollment. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/mfa')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary({ apiRoots: [] })
export class MfaSettingsController {
  constructor(private readonly db: PrismaService) {}

  @Get('settings')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read own login protection and remaining backup count; return no secrets',
  })
  @SchemaResponse({ type: SettingsResult, status: 200 })
  @ApiBadRequestResponse({ description: 'Unexpected query' })
  @ApiUnauthorizedResponse({ description: 'Current session authority is invalid' })
  @ApiForbiddenResponse({ description: 'Mixed credentials' })
  @ApiServiceUnavailableResponse({ description: 'Authority storage unavailable' })
  async read(
    @CurrentUser() principal: RequestPrincipal,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaSettingsViewSchema>> {
    if (Object.keys(req.query ?? {}).length)
      throw new AppException('Unexpected query', 400, 'VALIDATION_ERROR')
    if (
      Object.keys(req.headers).some(
        (name) =>
          ['cookie', 'x-api-key', 'x-mfa-continuation'].includes(name) ||
          name.startsWith('x-invitation-')
      )
    )
      throw new ForbiddenException('Mixed settings authority')
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: principal.sub },
      select: {
        email: true,
        systemRole: true,
        mfaAccount: true,
        mfaFactor: { select: { version: true } },
      },
    })
    const protectedAccount = accountRequiresMfa({
      systemRole: user.systemRole,
      required: user.mfaAccount?.required ?? false,
      emergencyRequired: user.mfaAccount?.emergencyRequired ?? false,
      factorVersion: user.mfaFactor?.version ?? null,
    })
    const remainingCodes = user.mfaAccount
      ? await this.db.mfaRecoveryCode.count({
          where: {
            userId: principal.sub,
            generation: user.mfaAccount.codeGeneration,
            consumedAt: null,
          },
        })
      : 0
    return {
      kind: 'settings' as const,
      accountLabel: user.email,
      protected: protectedAccount && !!user.mfaFactor && !!user.mfaAccount?.setupComplete,
      eligible: protectedAccount,
      remainingCodes,
    }
  }
}
