import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Request } from 'express'

import {
  AuthType,
  BROWSER_AUTH_HEADERS,
  browserLogoutReceiptInputSchema,
  browserLogoutReceiptLookupSchema,
  browserLogoutReceiptResultSchema,
  browserReturnProofSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { browserSessionContext } from '../frontend-context/browser-session-context.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { BrowserLogoutReceiptService } from './mfa/browser-logout-receipt.service.js'
import { BrowserPublicationGuard } from './mfa/browser-publication.guard.js'
import { settingsSourceChanged } from './mfa/mfa-settings-source.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class LogoutInput extends createSchemaDto(browserLogoutReceiptInputSchema) {}
class LookupInput extends createSchemaDto(browserLogoutReceiptLookupSchema) {}
class ClaimInput extends createSchemaDto(browserReturnProofSchema) {}
const Outcome = createSchemaDto(browserLogoutReceiptResultSchema, 'BrowserLogoutReceiptResult')
function binding(
  req: Request
): NonNullable<NonNullable<ReturnType<typeof browserSessionContext>>['binding']> {
  const actual = browserSessionContext(req)?.binding
  if (!actual) throw settingsSourceChanged()
  return actual
}

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({
  name: BROWSER_AUTH_HEADERS.key,
  required: true,
  description: 'Confidential BFF transport only',
})
@ApiHeader({
  name: BROWSER_AUTH_HEADERS.audience,
  required: true,
  enum: ['product', 'staff', 'console'],
})
@ApiBadRequestResponse({ description: 'Invalid strict receipt command' })
@ApiForbiddenResponse({ description: 'Mixed credentials or invalid private transport' })
@ApiConflictResponse({ description: 'Exact receipt/source transition does not match' })
@ApiServiceUnavailableResponse({ description: 'Receipt or authority storage unavailable' })
@Controller('auth/browser-publications')
@Auth(AuthType.None)
@UseGuards(BrowserPublicationGuard)
@OrganizationContextBoundary({ apiRoots: [] })
export class BrowserLogoutReceiptController {
  constructor(private readonly receipts: BrowserLogoutReceiptService) {}

  @Post('logout-with-receipt')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Retire one exact browser generation and atomically record its own logout result',
  })
  @SchemaResponse({ type: Outcome, status: 200 })
  logout(
    @Body({ schema: LogoutInput.schema }) body: LogoutInput,
    @Req() req: Request
  ): ReturnType<BrowserLogoutReceiptService['resolve']> {
    return this.receipts.resolve(binding(req), body, body)
  }

  @Post('logout-result')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read only one committed logout receipt; never grant a principal or replay logout',
  })
  @SchemaResponse({ type: Outcome, status: 200 })
  status(
    @Body({ schema: LookupInput.schema }) body: LookupInput,
    @Req() req: Request
  ): ReturnType<BrowserLogoutReceiptService['resolve']> {
    return this.receipts.resolve(binding(req), body)
  }

  @Post('return-claim')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Bind presentation-only return intent to one neutral attempt after its own logout',
  })
  @SchemaResponse({ type: Outcome, status: 200 })
  claim(
    @Body({ schema: ClaimInput.schema }) body: ClaimInput,
    @Req() req: Request
  ): ReturnType<BrowserLogoutReceiptService['resolve']> {
    return this.receipts.resolve(binding(req), body, undefined, body)
  }
}
