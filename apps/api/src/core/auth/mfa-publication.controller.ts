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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { z } from 'zod'

import {
  AuthType,
  mfaOperationInputSchema,
  publicationAcknowledgedSchema,
  publicationAcknowledgeInputSchema,
  publicationStatusSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { RateLimit } from '../../infrastructure/throttling/index.js'
import { PrismaService } from '../../prisma/index.js'

import { Auth } from './decorators/auth.decorator.js'
import { continuationRequest, MfaContinuationGuard } from './mfa/mfa-continuation.guard.js'
import { MfaPublicationAcknowledgementService } from './mfa/mfa-publication-acknowledgement.service.js'
import {
  type PublicationStatus,
  publicationStatus,
  retirePublication,
} from './mfa/mfa-publication-recovery.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class OperationInput extends createSchemaDto(mfaOperationInputSchema) {}
class AcknowledgeInput extends createSchemaDto(publicationAcknowledgeInputSchema) {}
class PublicationStatusDto extends createSchemaDto(publicationStatusSchema) {}
class AcknowledgedDto extends createSchemaDto(publicationAcknowledgedSchema) {}

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({ name: 'X-Mfa-Continuation', required: true })
@ApiBadRequestResponse({ description: 'Invalid strict command or unexpected query' })
@ApiForbiddenResponse({ description: 'Mixed credentials or invalid private browser transport' })
@ApiUnauthorizedResponse({ description: 'Invalid continuation or signed pending proof' })
@ApiConflictResponse({
  description: 'Exact publication changed or expired; never adopt another family',
})
@ApiTooManyRequestsResponse({ description: 'Restricted publication validator budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Publication cannot be confirmed; retain pending state',
})
@Controller('auth/mfa/publication')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(MfaContinuationGuard)
@RateLimit({ rate: 60, per: 60000, burst: 60 })
export class MfaPublicationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acknowledgements: MfaPublicationAcknowledgementService
  ) {}

  @Post('acknowledge')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Publish only the exact retained pending credentials; never create an ordinary request actor',
  })
  @SchemaResponse({ type: AcknowledgedDto, status: 200 })
  async acknowledge(
    @Body({ schema: AcknowledgeInput.schema }) body: AcknowledgeInput,
    @Req() req: Request
  ): Promise<z.infer<typeof publicationAcknowledgedSchema>> {
    return this.acknowledgements.acknowledge(continuationRequest(req, body.purpose), body)
  }

  @Post('status')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read only this issuance status after a lost response; never return credentials',
  })
  @SchemaResponse({ type: PublicationStatusDto, status: 200 })
  status(
    @Body({ schema: OperationInput.schema }) body: OperationInput,
    @Req() req: Request
  ): Promise<PublicationStatus> {
    return this.prisma.$transaction(
      (tx) => publicationStatus(tx, continuationRequest(req, body.purpose), body.operationId),
      { maxWait: 2000, timeout: 4000 }
    )
  }

  @Post('retire')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Retire only this still-current unpublished candidate; never revoke a newer or published family',
  })
  @SchemaResponse({ type: PublicationStatusDto, status: 200 })
  retire(
    @Body({ schema: OperationInput.schema }) body: OperationInput,
    @Req() req: Request
  ): Promise<PublicationStatus> {
    return this.prisma.$transaction(
      (tx) => retirePublication(tx, continuationRequest(req, body.purpose), body.operationId),
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
