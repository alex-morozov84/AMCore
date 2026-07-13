import type { Response } from 'express'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import type { RequestPrincipal } from '@amcore/shared'

import { NotFoundException } from '../../../common/exceptions'
import type { AiConversationAccessAuthorizer } from '../conversations/ai-conversation-access.authorizer'

import { AiArtifactDownloadService } from './ai-artifact-download.service'

import { AuditLogService } from '@/core/audit'
import type { StorageDownloadService } from '@/infrastructure/storage'
import type { PrismaService } from '@/prisma'

const principal = { type: 'jwt', sub: 'owner-1' } as RequestPrincipal
const res = {} as Response

const ownerAuthorized = {
  actor: { userId: 'owner-1', isSuperAdmin: false },
  isCrossUser: false,
  reason: undefined,
}
const operatorAuthorized = {
  actor: { userId: 'admin-9', isSuperAdmin: true },
  isCrossUser: true,
  reason: 'SUPPORT-1234',
}

describe('AiArtifactDownloadService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let authorizer: { authorize: jest.Mock }
  let audit: { record: jest.Mock }
  let storageDownload: { streamObject: jest.Mock }
  let service: AiArtifactDownloadService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    authorizer = { authorize: jest.fn() }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    storageDownload = { streamObject: jest.fn().mockResolvedValue('stream' as never) }
    service = new AiArtifactDownloadService(
      prisma,
      authorizer as unknown as AiConversationAccessAuthorizer,
      audit as unknown as AuditLogService,
      storageDownload as unknown as StorageDownloadService
    )
    prisma.aiArtifact.findFirst.mockResolvedValue({
      kind: 'IMAGE',
      storageKey: 'ai-artifacts/conv-1/art-1/original',
    } as never)
  })

  it('delegates authorization to the shared authorizer (owner/cross-user + step-up + reason)', async () => {
    authorizer.authorize.mockResolvedValue(ownerAuthorized)
    await service.download(principal, 'conv-1', 'art-1', undefined, res)
    expect(authorizer.authorize).toHaveBeenCalledWith(principal, 'conv-1', undefined)
  })

  it('404s (no leak) when the artifact is not in the authorized conversation', async () => {
    authorizer.authorize.mockResolvedValue(ownerAuthorized)
    prisma.aiArtifact.findFirst.mockResolvedValue(null as never)
    await expect(service.download(principal, 'conv-1', 'ghost', undefined, res)).rejects.toThrow(
      NotFoundException
    )
    expect(storageDownload.streamObject).not.toHaveBeenCalled()
  })

  it('resolves the artifact scoped to the conversation (no cross-conversation reach)', async () => {
    authorizer.authorize.mockResolvedValue(ownerAuthorized)
    await service.download(principal, 'conv-1', 'art-1', undefined, res)
    expect(prisma.aiArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'art-1', conversationId: 'conv-1' } })
    )
  })

  it('does NOT audit an owner reading their own artifact, and streams it', async () => {
    authorizer.authorize.mockResolvedValue(ownerAuthorized)
    const result = await service.download(principal, 'conv-1', 'art-1', undefined, res)
    expect(audit.record).not.toHaveBeenCalled()
    expect(storageDownload.streamObject).toHaveBeenCalledWith(
      'ai-artifacts/conv-1/art-1/original',
      res
    )
    expect(result).toBe('stream')
  })

  it('audits a cross-user operator read with content-free metadata, FAIL-CLOSED before streaming', async () => {
    authorizer.authorize.mockResolvedValue(operatorAuthorized)
    // Record call order: the audit must be awaited before any byte is served.
    const order: string[] = []
    audit.record.mockImplementation(async () => {
      order.push('audit')
    })
    storageDownload.streamObject.mockImplementation(async () => {
      order.push('stream')
      return 'stream'
    })

    await service.download(principal, 'conv-1', 'art-1', 'SUPPORT-1234', res)

    expect(order).toEqual(['audit', 'stream'])
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.conversation.artifact_accessed',
        actorId: 'admin-9',
        targetType: 'AI_CONVERSATION',
        targetId: 'conv-1',
        metadata: {
          conversationId: 'conv-1',
          artifactId: 'art-1',
          kind: 'image',
          actorRole: 'operator',
          reasonRef: 'SUPPORT-1234',
        },
      }),
      // Strict, fail-closed: the audit MUST be durable before bytes are served.
      { failOpen: false }
    )
    // The audit metadata carries NO storage key, hash, filename, or content bytes.
    const metadata = audit.record.mock.calls[0]![0].metadata as Record<string, unknown>
    expect(JSON.stringify(metadata)).not.toContain('ai-artifacts/')
  })

  it('does not serve bytes when the REAL fail-closed audit write fails (production behavior, not a mock)', async () => {
    // Wire the download service against a REAL AuditLogService whose DB write rejects — this proves
    // production fail-closed: a mock that rejects would only prove the mock, but the real strict
    // (failOpen:false) path actually propagates a `prisma.auditLog.create` failure.
    authorizer.authorize.mockResolvedValue(operatorAuthorized)
    ;(prisma.auditLog.create as jest.Mock).mockRejectedValue(new Error('db down'))
    const cls = { get: jest.fn(), getId: jest.fn(() => 'req-1') } as unknown as ClsService
    const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger
    const realAudit = new AuditLogService(prisma, cls, logger)
    const serviceWithRealAudit = new AiArtifactDownloadService(
      prisma,
      authorizer as unknown as AiConversationAccessAuthorizer,
      realAudit,
      storageDownload as unknown as StorageDownloadService
    )

    await expect(
      serviceWithRealAudit.download(principal, 'conv-1', 'art-1', 'SUPPORT-1234', res)
    ).rejects.toThrow('db down')
    expect(storageDownload.streamObject).not.toHaveBeenCalled()
  })
})
