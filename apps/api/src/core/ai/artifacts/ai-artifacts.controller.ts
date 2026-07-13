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
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { ZodResponse } from 'nestjs-zod'

import {
  AI_OPERATOR_REASON_HEADER,
  type AiArtifactResponse,
  AuthType,
  type RequestPrincipal,
} from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { AiArtifactResponseDto } from '../dto/ai.dto'

import { AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES } from './ai-artifact.constants'
import { AiArtifactDownloadService } from './ai-artifact-download.service'
import {
  AiArtifactUploadService,
  type UploadableAiArtifactFile,
} from './ai-artifact-upload.service'

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
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES } })
  )
  @ApiOperation({ summary: 'Upload an image/PDF artifact into an owned AI conversation' })
  @ZodResponse({ type: AiArtifactResponseDto, status: 201, description: 'Artifact stored' })
  uploadArtifact(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
    @UploadedFile() file: UploadableAiArtifactFile
  ): Promise<AiArtifactResponse> {
    return this.upload.upload(userId, conversationId, file)
  }

  @Get(':id/artifacts/:artifactId')
  // No `@ZodResponse`: the body is a binary stream (StreamableFile), not a JSON DTO — so the global
  // ZodSerializerInterceptor passes it through (matches the metrics-scrape passthrough precedent).
  @ApiProduces('application/octet-stream')
  @ApiHeader({
    name: AI_OPERATOR_REASON_HEADER,
    required: false,
    description: 'Reason / ticket ref — required for a cross-user SUPER_ADMIN operator download.',
  })
  @ApiOperation({ summary: 'Download an artifact (owner or SUPER_ADMIN operator)' })
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
