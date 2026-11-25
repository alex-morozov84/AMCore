import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  type StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-fastify'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import {
  AI_OPERATOR_REASON_HEADER,
  type AiArtifactResponse,
  AuthType,
  type RequestPrincipal,
} from '@amcore/shared'

import { SchemaResponse } from '../../../common/schemas/schema-response.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../../infrastructure/throttling/index.js'
import { Auth } from '../../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { AiArtifactResponseDto } from '../dto/ai.dto.js'

import { AI_ARTIFACT_ALLOWED_MIME_TYPES, AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES } from './ai-artifact.constants.js'
import { AiArtifactDownloadService } from './ai-artifact-download.service.js'
import {
  AiArtifactUploadService,
  type UploadableAiArtifactFile,
} from './ai-artifact-upload.service.js'

/**
 * AI artifact upload + download (Track C — ADR-054, Arc G), bearer-authenticated. Web role only —
 * Postgres + storage I/O, no provider I/O. Upload is owner-only; download follows the Arc F
 * transcript-read posture (owner, or cross-user SUPER_ADMIN operator with step-up + a bounded reason).
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/conversations')
export class AiArtifactsController {
  constructor(
    private readonly upload: AiArtifactUploadService,
    private readonly download: AiArtifactDownloadService
  ) {}

  @Post(':id/artifacts')
  // Per-handler throttle, mirroring the avatar upload's 5/min/IP (narrows the global `long`
  // bucket for this heavy, rarely-repeated multipart write).
  @RateLimit(RATE_LIMIT_POLICIES.EXPENSIVE_ACTION)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES } })
  )
  @ApiOperation({ summary: 'Upload an image/PDF artifact into an owned AI conversation' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing file, unsupported type, or invalid file.' })
  @ApiResponse({ status: 404, description: 'The conversation does not exist or is not owned by the caller.' })
  @ApiResponse({ status: 409, description: 'The conversation state does not allow an upload.' })
  @ApiResponse({ status: 413, description: 'The upload exceeds the transport or file-type size limit.' })
  @SchemaResponse({ type: AiArtifactResponseDto, status: 201, description: 'Artifact stored' })
  uploadArtifact(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
    @UploadedFile() file: UploadableAiArtifactFile
  ): Promise<AiArtifactResponse> {
    return this.upload.upload(userId, conversationId, file)
  }

  @Get(':id/artifacts/:artifactId')
  // No `@SchemaResponse`: the body is a binary stream (StreamableFile), not a JSON DTO — so the global
  // SchemaResponseInterceptor passes it through (matches the metrics-scrape passthrough precedent).
  @ApiProduces(...AI_ARTIFACT_ALLOWED_MIME_TYPES, 'application/octet-stream')
  @ApiHeader({
    name: AI_OPERATOR_REASON_HEADER,
    required: false,
    description: 'Reason / ticket ref — required for a cross-user SUPER_ADMIN operator download.',
  })
  @ApiOperation({ summary: 'Download an artifact (owner or SUPER_ADMIN operator)' })
  @ApiResponse({ status: 400, description: 'Missing or invalid operator reason for cross-user access.' })
  @ApiResponse({ status: 404, description: 'The conversation, artifact, or its bytes are unavailable to the caller.' })
  @ApiResponse({ status: 500, description: 'Storage or the mandatory access audit failed before download.' })
  @ApiOkResponse({
    description: 'The artifact bytes, served as an attachment (never a URL).',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Content-Length': { schema: { type: 'integer', minimum: 0 } },
      'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
      ETag: { description: 'Present when available from storage.', schema: { type: 'string' } },
      'Last-Modified': { description: 'HTTP date when available from storage.', schema: { type: 'string' } },
    },
  })
  downloadArtifact(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') conversationId: string,
    @Param('artifactId') artifactId: string,
    // Reason via header (never a query param) so it can't land in access-log URLs; redacted in logs.
    @Headers(AI_OPERATOR_REASON_HEADER) reason: string | undefined,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    return this.download.download(principal, conversationId, artifactId, reason, res)
  }
}
