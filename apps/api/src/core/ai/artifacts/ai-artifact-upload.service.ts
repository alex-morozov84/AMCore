import { createHash, randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import type { AiArtifactResponse } from '@amcore/shared'

import {
  AppException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../../common/exceptions'
import { toAiArtifactResponse } from '../runs/ai-run.mapper'

import { AI_ARTIFACT_ALLOWED_MIME_TYPES, detectAiArtifactKind } from './ai-artifact.constants'

import { EnvService } from '@/env/env.service'
import {
  AiArtifactKind,
  AiConversationControl,
  AiConversationState,
} from '@/generated/prisma/client'
import { type AiMetricsArtifactKind, MetricsService } from '@/infrastructure/observability'
import { normalizeObjectKey, StorageService } from '@/infrastructure/storage'
import { PrismaService } from '@/prisma'

/** Minimal shape of an in-memory (Multer) upload this service validates. */
export interface UploadableAiArtifactFile {
  buffer: Buffer
}

/** The magic-byte-detected kind + its exact MIME type (never the client-declared `Content-Type`). */
interface DetectedArtifact {
  kind: AiArtifactKind
  contentType: string
}

/** Low-cardinality metric label for a resolved `AiArtifactKind`. */
function artifactKindLabel(kind: AiArtifactKind): AiMetricsArtifactKind {
  return kind === AiArtifactKind.IMAGE ? 'image' : 'pdf'
}

/**
 * Artifact upload (Track C — ADR-054, Arc G, web role). Validates bytes via magic-byte detection
 * (never client `Content-Type`), stores them PRIVATE under a per-conversation key, and inserts the
 * `AiArtifact` row. No provider I/O — Postgres + `StorageService` writes only.
 *
 * Deliberately does **not** go through the generic `FileValidationPipe`: that pipe applies one
 * flat `maxSize` before MIME detection, but Arc G needs a *kind-dependent* cap (image vs PDF,
 * §5 of the FINAL PLAN) that can only be resolved after magic-byte detection tells us which kind
 * we're looking at. So detection and size enforcement are sequenced explicitly here instead.
 */
@Injectable()
export class AiArtifactUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly env: EnvService,
    private readonly metrics: MetricsService
  ) {}

  async upload(
    userId: string,
    conversationId: string,
    file: UploadableAiArtifactFile
  ): Promise<AiArtifactResponse> {
    if (!file?.buffer) {
      throw new BadRequestException('File is required')
    }
    await this.assertOwnedActiveConversation(conversationId, userId)

    const detected = await this.detectArtifact(file.buffer)
    this.assertWithinSizeLimit(detected.kind, file.buffer.length)

    const key = normalizeObjectKey(`ai-artifacts/${conversationId}/${randomUUID()}/original`)
    await this.storage.upload({ key, body: file.buffer, contentType: detected.contentType })

    const artifact = await this.prisma.aiArtifact.create({
      data: {
        conversationId,
        kind: detected.kind,
        contentType: detected.contentType,
        sizeBytes: file.buffer.length,
        hash: createHash('sha256').update(file.buffer).digest('hex'),
        storageKey: key,
      },
    })
    this.metrics.incAiArtifactUpload(artifactKindLabel(detected.kind), 'success')
    return toAiArtifactResponse(artifact)
  }

  /**
   * Conversation must be owned by the caller and `ACTIVE`/`controlledBy=BOT` — matches the run
   * producer's existing gate verbatim (a human-held or closed conversation cannot receive new
   * bot-consumable input). A missing or not-owned conversation is a 404 (no existence leak).
   */
  private async assertOwnedActiveConversation(
    conversationId: string,
    userId: string
  ): Promise<void> {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      select: { ownerUserId: true, state: true, controlledBy: true },
    })
    if (!conversation || conversation.ownerUserId !== userId) {
      throw new NotFoundException('Conversation', conversationId)
    }
    if (
      conversation.state !== AiConversationState.ACTIVE ||
      conversation.controlledBy !== AiConversationControl.BOT
    ) {
      throw new ConflictException(
        'This conversation is under human control or closed; an artifact cannot be uploaded.'
      )
    }
  }

  /**
   * Magic-byte MIME detection (never the client-declared type). An undetectable or unsupported
   * type is rejected without a metric emission — the `amcore_ai_artifact_uploads_total{kind}`
   * label is bounded to `image`/`pdf`, so a request that never resolves to a known kind has
   * nothing bounded to attribute; the generic HTTP RED metrics already count the resulting 400.
   */
  private async detectArtifact(buffer: Buffer): Promise<DetectedArtifact> {
    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(buffer)
    const kind = detected ? detectAiArtifactKind(detected.mime) : null
    if (kind === null || !detected) {
      throw new BadRequestException(
        `Invalid file type: ${detected?.mime ?? 'unknown'}. Allowed: ${AI_ARTIFACT_ALLOWED_MIME_TYPES.join(', ')}`
      )
    }
    return { kind, contentType: detected.mime }
  }

  private assertWithinSizeLimit(kind: AiArtifactKind, sizeBytes: number): void {
    const maxBytes =
      kind === AiArtifactKind.IMAGE
        ? this.env.get('AI_ARTIFACT_MAX_IMAGE_BYTES')
        : this.env.get('AI_ARTIFACT_MAX_DOCUMENT_BYTES')
    if (sizeBytes > maxBytes) {
      this.metrics.incAiArtifactUpload(artifactKindLabel(kind), 'rejected')
      throw new AppException(
        `File too large: ${sizeBytes} bytes (max: ${maxBytes})`,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE'
      )
    }
  }
}
