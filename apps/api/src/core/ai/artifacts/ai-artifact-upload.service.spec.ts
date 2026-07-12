import { AiArtifactKind, AiConversationControl, AiConversationState } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AppException, BadRequestException, ConflictException } from '../../../common/exceptions'
import { NotFoundException } from '../../../common/exceptions'

import { AiArtifactUploadService } from './ai-artifact-upload.service'

import type { EnvService } from '@/env/env.service'
import type { StorageService } from '@/infrastructure/storage'
import type { PrismaService } from '@/prisma'

// `file-type` is ESM-only; mirrors the FileValidationPipe spec's mock (verified against the real
// library's magic-byte output for these sample bodies).
jest.mock('file-type', () => ({
  __esModule: true,
  fileTypeFromBuffer: async (buf: Buffer) => {
    const at = (i: number, b: number): boolean => buf[i] === b
    const ascii = (start: number, end: number): string =>
      buf.subarray(start, end).toString('latin1')
    if (at(0, 0x89) && at(1, 0x50) && at(2, 0x4e) && at(3, 0x47))
      return { ext: 'png', mime: 'image/png' }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
      return { ext: 'webp', mime: 'image/webp' }
    if (ascii(0, 3) === 'GIF') return { ext: 'gif', mime: 'image/gif' }
    if (ascii(0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' }
    if (at(0, 0x4d) && at(1, 0x5a)) return { ext: 'exe', mime: 'application/x-msdownload' }
    return undefined
  },
}))

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
])
const GIF = Buffer.from('GIF89a' + '.'.repeat(16))
const PDF = Buffer.from('%PDF-1.4\n%binary\n')
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)])

function fakeConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerUserId: 'user-1',
    state: AiConversationState.ACTIVE,
    controlledBy: AiConversationControl.BOT,
    ...overrides,
  }
}

describe('AiArtifactUploadService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let storage: { upload: jest.Mock }
  let env: { get: jest.Mock }
  let metrics: { incAiArtifactUpload: jest.Mock }
  let service: AiArtifactUploadService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    storage = { upload: jest.fn().mockResolvedValue({ key: 'k', size: 1 }) }
    env = {
      get: jest.fn((key: string) =>
        key === 'AI_ARTIFACT_MAX_IMAGE_BYTES' ? 5_242_880 : 10_485_760
      ),
    }
    metrics = { incAiArtifactUpload: jest.fn() }
    service = new AiArtifactUploadService(
      prisma,
      storage as unknown as StorageService,
      env as unknown as EnvService,
      metrics as never
    )
    prisma.aiConversation.findUnique.mockResolvedValue(fakeConversation() as never)
  })

  it('rejects a missing file', async () => {
    await expect(service.upload('user-1', 'conv-1', undefined as never)).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  it('404s a missing conversation (no existence leak)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(null)
    await expect(service.upload('user-1', 'conv-1', { buffer: PNG })).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('hides a conversation owned by someone else (404)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(
      fakeConversation({ ownerUserId: 'other' }) as never
    )
    await expect(service.upload('user-1', 'conv-1', { buffer: PNG })).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('rejects upload into a human-held conversation (409)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(
      fakeConversation({ controlledBy: AiConversationControl.HUMAN }) as never
    )
    await expect(service.upload('user-1', 'conv-1', { buffer: PNG })).rejects.toBeInstanceOf(
      ConflictException
    )
  })

  it('rejects upload into a closed conversation (409)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(
      fakeConversation({ state: AiConversationState.CLOSED }) as never
    )
    await expect(service.upload('user-1', 'conv-1', { buffer: PNG })).rejects.toBeInstanceOf(
      ConflictException
    )
  })

  it('rejects an undetectable/unsupported file type and never emits a metric for it', async () => {
    await expect(
      service.upload('user-1', 'conv-1', { buffer: Buffer.from('not a real file') })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(metrics.incAiArtifactUpload).not.toHaveBeenCalled()
  })

  it('rejects an EXE body regardless of any spoofed content-type', async () => {
    await expect(service.upload('user-1', 'conv-1', { buffer: EXE })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  it('rejects SVG (stored-XSS; not on the allowlist)', async () => {
    await expect(service.upload('user-1', 'conv-1', { buffer: SVG })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  it('rejects GIF even though file-type detects it (Arc G deliberately excludes it)', async () => {
    await expect(service.upload('user-1', 'conv-1', { buffer: GIF })).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects an oversize image with 413 and a rejected metric, before any storage write', async () => {
    env.get.mockImplementation((key: string) =>
      key === 'AI_ARTIFACT_MAX_IMAGE_BYTES' ? 4 : 10_485_760
    )
    const err = await service.upload('user-1', 'conv-1', { buffer: PNG }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).getStatus()).toBe(413)
    expect(storage.upload).not.toHaveBeenCalled()
    expect(metrics.incAiArtifactUpload).toHaveBeenCalledWith('image', 'rejected')
  })

  it('rejects an oversize PDF with 413 using the document-specific cap', async () => {
    env.get.mockImplementation((key: string) =>
      key === 'AI_ARTIFACT_MAX_DOCUMENT_BYTES' ? 4 : 5_242_880
    )
    const err = await service.upload('user-1', 'conv-1', { buffer: PDF }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).getStatus()).toBe(413)
    expect(metrics.incAiArtifactUpload).toHaveBeenCalledWith('pdf', 'rejected')
  })

  it('stores a valid PNG privately under a conversation-scoped key and records a success metric', async () => {
    prisma.aiArtifact.create.mockResolvedValue({
      id: 'art-1',
      kind: AiArtifactKind.IMAGE,
      contentType: 'image/png',
      sizeBytes: PNG.length,
      trustLevel: 'UNTRUSTED',
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
    } as never)

    const result = await service.upload('user-1', 'conv-1', { buffer: PNG })

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^ai-artifacts\/conv-1\/[^/]+\/original$/),
        body: PNG,
        contentType: 'image/png',
      })
    )
    expect(storage.upload.mock.calls[0]![0]).not.toHaveProperty('visibility')
    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          kind: AiArtifactKind.IMAGE,
          contentType: 'image/png',
          sizeBytes: PNG.length,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      })
    )
    expect(metrics.incAiArtifactUpload).toHaveBeenCalledWith('image', 'success')
    expect(result).toMatchObject({ id: 'art-1', kind: 'image', trustLevel: 'untrusted' })
  })

  it('stores a valid PDF as kind pdf', async () => {
    prisma.aiArtifact.create.mockResolvedValue({
      id: 'art-2',
      kind: AiArtifactKind.PDF,
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      trustLevel: 'UNTRUSTED',
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
    } as never)

    const result = await service.upload('user-1', 'conv-1', { buffer: PDF })

    expect(prisma.aiArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: AiArtifactKind.PDF }) })
    )
    expect(metrics.incAiArtifactUpload).toHaveBeenCalledWith('pdf', 'success')
    expect(result.kind).toBe('pdf')
  })
})
