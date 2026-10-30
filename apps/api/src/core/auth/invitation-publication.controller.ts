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

import {
  AuthType,
  invitationPublicationInputSchema,
  publicationAcknowledgedSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { RateLimit } from '../../infrastructure/throttling/index.js'
import { invitationHandoffProof } from '../invitations/invitation-auth-handoff.js'

import { Auth } from './decorators/auth.decorator.js'
import { continuationRequest, MfaContinuationGuard } from './mfa/mfa-continuation.guard.js'
import { MfaPublicationAcknowledgementService } from './mfa/mfa-publication-acknowledgement.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class ConfirmationInput extends createSchemaDto(invitationPublicationInputSchema) {}
class ConfirmationResult extends createSchemaDto(publicationAcknowledgedSchema) {}

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({
  name: 'X-Mfa-Continuation',
  required: true,
  description: 'Exact pending issuance capability, not ordinary authorization',
})
@ApiUnauthorizedResponse({ description: 'Invalid signed pending proof or exact browser binding' })
@ApiForbiddenResponse({ description: 'Mixed credentials or invalid private transport' })
@ApiBadRequestResponse({ description: 'Invalid strict command or query' })
@ApiConflictResponse({
  description: 'Handoff, family, account version, generation or deadline changed',
})
@ApiTooManyRequestsResponse({ description: 'Restricted publication validator budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Confirmation unproven; no membership or ordinary access is inferred',
})
@Controller('auth/browser-publications')
@Auth(AuthType.None)
@UseGuards(MfaContinuationGuard)
@OrganizationContextBoundary({ apiRoots: [] })
@RateLimit({ rate: 60, per: 60000, burst: 60 })
export class InvitationPublicationController {
  constructor(private readonly acknowledgements: MfaPublicationAcknowledgementService) {}

  @Post('invitation-confirm')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Confirm one invitation handoff and publish its exact family in one transaction; never accept membership',
  })
  @SchemaResponse({ type: ConfirmationResult, status: 200 })
  confirm(
    @Body({ schema: ConfirmationInput.schema }) body: ConfirmationInput,
    @Req() req: Request
  ): Promise<{ outcome: 'published' }> {
    const proof = invitationHandoffProof(body.handoff.attemptId, body.handoff.cleanupKey)!
    return this.acknowledgements.acknowledge(continuationRequest(req, body.purpose), body, proof)
  }
}
