import { Injectable, type StreamableFile } from '@nestjs/common'
import type { Response } from 'express'

import type { RequestPrincipal } from '@amcore/shared'

import { NotFoundException } from '../../../common/exceptions'
import { AiConversationAccessAuthorizer } from '../conversations/ai-conversation-access.authorizer'

import { AuditLogService } from '@/core/audit'
import { AuditActorType, AuditTargetType } from '@/generated/prisma/client'
import { StorageDownloadService } from '@/infrastructure/storage'
import { PrismaService } from '@/prisma'

/**
 * Authorized artifact download (Track C — ADR-054, Arc G, web role). An artifact is conversation
 * content, so access follows the **exact same** posture as the Arc F transcript read — owner, or a
 * cross-user SUPER_ADMIN operator gated by step-up + a bounded reason — via the shared
 * `AiConversationAccessAuthorizer` (never a second copy of cross-user auth). A cross-user read is
 * **audited fail-closed** (`ai.conversation.artifact_accessed`, awaited BEFORE any bytes are served);
 * an owner reading their own artifact is not audited. Bytes are streamed app-mediated through
 * `StorageDownloadService` (attachment + nosniff, no Range, never a signed/public URL). A missing or
 * not-visible conversation/artifact is a `404` — existence never leaks.
 */
@Injectable()
export class AiArtifactDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizer: AiConversationAccessAuthorizer,
    private readonly audit: AuditLogService,
    private readonly storageDownload: StorageDownloadService
  ) {}

  async download(
    principal: RequestPrincipal,
    conversationId: string,
    artifactId: string,
    reason: string | undefined,
    res: Response
  ): Promise<StreamableFile> {
    const authorized = await this.authorizer.authorize(principal, conversationId, reason)

    // Resolve the artifact scoped to the (already-authorized) conversation: a foreign or nonexistent
    // artifact id is a no-leak 404 (the two cases are indistinguishable from this query).
    const artifact = await this.prisma.aiArtifact.findFirst({
      where: { id: artifactId, conversationId },
      select: { kind: true, storageKey: true },
    })
    if (artifact === null) throw new NotFoundException('Artifact', artifactId)

    if (authorized.isCrossUser) {
      // Fail-CLOSED accountability (ADR-045): the privileged read is recorded with `failOpen: false`
      // and awaited BEFORE any byte flows — if the audit write fails, this throws and no bytes are
      // served. (Plain best-effort `record()` would swallow the failure and leak the artifact.)
      await this.audit.record(
        {
          action: 'ai.conversation.artifact_accessed',
          actorType: AuditActorType.USER,
          actorId: authorized.actor.userId,
          targetType: AuditTargetType.AI_CONVERSATION,
          targetId: conversationId,
          metadata: {
            conversationId,
            artifactId,
            kind: artifact.kind.toLowerCase(),
            actorRole: 'operator',
            reasonRef: authorized.reason,
          },
        },
        { failOpen: false }
      )
    }

    return this.storageDownload.streamObject(artifact.storageKey, res)
  }
}
