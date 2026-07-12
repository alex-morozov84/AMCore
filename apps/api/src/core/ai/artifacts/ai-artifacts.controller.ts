import { Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ZodResponse } from 'nestjs-zod'

import { type AiArtifactResponse, AuthType } from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { AiArtifactResponseDto } from '../dto/ai.dto'

import { AI_ARTIFACT_UPLOAD_HARD_LIMIT_BYTES } from './ai-artifact.constants'
import {
  AiArtifactUploadService,
  type UploadableAiArtifactFile,
} from './ai-artifact-upload.service'

/**
 * AI artifact upload (Track C — ADR-054, Arc G), bearer-authenticated and owner-scoped. Web role
 * only — Postgres + private storage writes, no provider I/O. Download lands in G.5.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/conversations')
export class AiArtifactsController {
  constructor(private readonly upload: AiArtifactUploadService) {}

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
}
