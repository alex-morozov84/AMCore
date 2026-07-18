import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import type {
  CreateAiAssistantInput,
  PublishAiAssistantVersionInput,
  RequestPrincipal,
} from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../../common/exceptions'
import type { AuditLogService } from '../../audit'

import { AiAssistantAdminService } from './ai-assistant-admin.service'

import { type AiAssistant, Prisma } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

const actor = { sub: 'admin-1' } as RequestPrincipal

const baseInput: CreateAiAssistantInput = {
  slug: 'support-bot',
  displayName: 'Support Bot',
  enabled: false,
  systemPrompt: 'You are a support assistant.',
  modelSelection: { modelSlug: 'claude-default', fallback: [] },
  allowedModalities: ['text'],
  toolAllowlist: [],
  budgetClass: null,
}

function assistantRow(overrides: Partial<AiAssistant> = {}): AiAssistant {
  const now = new Date('2026-07-11T00:00:00.000Z')
  return {
    id: 'asst-1',
    slug: 'support-bot',
    version: 1,
    displayName: 'Support Bot',
    enabled: false,
    systemPrompt: 'You are a support assistant.',
    modelSelection: { modelSlug: 'claude-default', fallback: [] } as Prisma.JsonValue,
    allowedModalities: ['text'],
    toolAllowlist: [],
    guardrailPolicy: null,
    budgetClass: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('AiAssistantAdminService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: { record: jest.Mock }
  let metrics: { incAiAssistantAdmin: jest.Mock }
  let service: AiAssistantAdminService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    // Run the transaction callback against the same mock client (tx === prisma).
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      (cb: (tx: unknown) => unknown) => cb(prisma)
    )
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    metrics = { incAiAssistantAdmin: jest.fn() }
    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
    } as unknown as PinoLogger
    service = new AiAssistantAdminService(
      prisma,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      logger
    )
  })

  describe('create', () => {
    it('creates version 1, audits created, and counts the metric', async () => {
      prisma.aiAssistant.findFirst.mockResolvedValue(null)
      prisma.aiAssistant.create.mockResolvedValue(assistantRow())

      const result = await service.create(actor, baseInput)

      expect(prisma.aiAssistant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slug: 'support-bot', version: 1 }),
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.assistant.created', targetType: 'AI_ASSISTANT' }),
        { tx: prisma }
      )
      expect(metrics.incAiAssistantAdmin).toHaveBeenCalledWith('created')
      expect(result.slug).toBe('support-bot')
    })

    it('never puts the systemPrompt in the audit metadata', async () => {
      prisma.aiAssistant.findFirst.mockResolvedValue(null)
      prisma.aiAssistant.create.mockResolvedValue(assistantRow())

      await service.create(actor, baseInput)

      const metadata = audit.record.mock.calls[0]![0].metadata as Record<string, unknown>
      expect(JSON.stringify(metadata)).not.toContain('support assistant')
      expect(metadata).toEqual(
        expect.objectContaining({ slug: 'support-bot', version: 1, enabled: false })
      )
    })

    it('rejects a slug that already exists with 409', async () => {
      prisma.aiAssistant.findFirst.mockResolvedValue(assistantRow())

      await expect(service.create(actor, baseInput)).rejects.toThrow(ConflictException)
      expect(prisma.aiAssistant.create).not.toHaveBeenCalled()
    })

    it('maps a concurrent create that wins the (slug, version) unique constraint to 409', async () => {
      prisma.aiAssistant.findFirst.mockResolvedValue(null)
      prisma.aiAssistant.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '7.8.0',
        })
      )

      await expect(service.create(actor, baseInput)).rejects.toThrow(ConflictException)
    })
  })

  describe('publishVersion', () => {
    const versionInput: PublishAiAssistantVersionInput = {
      displayName: 'Support Bot v2',
      enabled: true,
      systemPrompt: 'Updated prompt.',
      modelSelection: { modelSlug: 'claude-default', fallback: [] },
      allowedModalities: ['text'],
      toolAllowlist: [],
      budgetClass: null,
    }

    it('publishes the next version and audits version_published', async () => {
      prisma.aiAssistant.aggregate.mockResolvedValue({ _max: { version: 2 } } as never)
      prisma.aiAssistant.create.mockResolvedValue(assistantRow({ id: 'asst-3', version: 3 }))

      const result = await service.publishVersion(actor, 'support-bot', versionInput)

      expect(prisma.aiAssistant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slug: 'support-bot', version: 3 }),
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.assistant.version_published' }),
        { tx: prisma }
      )
      expect(metrics.incAiAssistantAdmin).toHaveBeenCalledWith('version_published')
      expect(result.version).toBe(3)
    })

    it('404s for an unknown slug', async () => {
      prisma.aiAssistant.aggregate.mockResolvedValue({ _max: { version: null } } as never)

      await expect(service.publishVersion(actor, 'ghost', versionInput)).rejects.toThrow(
        NotFoundException
      )
    })

    it('maps a concurrent (slug, version) unique violation to 409', async () => {
      prisma.aiAssistant.aggregate.mockResolvedValue({ _max: { version: 2 } } as never)
      prisma.aiAssistant.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '7.8.0',
        })
      )

      await expect(service.publishVersion(actor, 'support-bot', versionInput)).rejects.toThrow(
        ConflictException
      )
    })
  })

  describe('update', () => {
    it('audits disabled when enabled flips true → false', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(assistantRow({ enabled: true }))
      prisma.aiAssistant.update.mockResolvedValue(assistantRow({ enabled: false }))

      await service.update(actor, 'asst-1', { enabled: false })

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.assistant.disabled' }),
        { tx: prisma }
      )
      expect(metrics.incAiAssistantAdmin).toHaveBeenCalledWith('disabled')
    })

    it('audits enabled when enabled flips false → true', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(assistantRow({ enabled: false }))
      prisma.aiAssistant.update.mockResolvedValue(assistantRow({ enabled: true }))

      await service.update(actor, 'asst-1', { enabled: true })

      expect(metrics.incAiAssistantAdmin).toHaveBeenCalledWith('enabled')
    })

    it('audits updated for a displayName-only change', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(assistantRow())
      prisma.aiAssistant.update.mockResolvedValue(assistantRow({ displayName: 'Renamed' }))

      await service.update(actor, 'asst-1', { displayName: 'Renamed' })

      expect(metrics.incAiAssistantAdmin).toHaveBeenCalledWith('updated')
    })

    it('404s when the assistant is missing', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(null)

      await expect(service.update(actor, 'nope', { enabled: true })).rejects.toThrow(
        NotFoundException
      )
      expect(prisma.aiAssistant.update).not.toHaveBeenCalled()
    })

    it('is a no-op (no write/audit/metric) when nothing actually changes', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(assistantRow({ enabled: true }))

      const result = await service.update(actor, 'asst-1', { enabled: true })

      expect(result.id).toBe('asst-1')
      expect(prisma.aiAssistant.update).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
      expect(metrics.incAiAssistantAdmin).not.toHaveBeenCalled()
    })
  })

  describe('get', () => {
    it('404s when missing', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue(null)
      await expect(service.get('nope')).rejects.toThrow(NotFoundException)
    })
  })

  describe('list', () => {
    it('returns all versions (newest first) when version=all', async () => {
      prisma.aiAssistant.findMany.mockResolvedValue([
        assistantRow({ id: 'a2', version: 2 }),
        assistantRow({ id: 'a1', version: 1 }),
      ])
      prisma.aiAssistant.count.mockResolvedValue(2)

      const result = await service.list({ version: 'all', page: 1, limit: 20 })

      expect(prisma.aiAssistant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ slug: 'asc' }, { version: 'desc' }] })
      )
      expect(result.total).toBe(2)
      expect(result.data).toHaveLength(2)
    })

    it('collapses to latest-per-slug by default via groupBy', async () => {
      prisma.aiAssistant.groupBy.mockResolvedValueOnce([
        { slug: 'support-bot', _max: { version: 3 } },
      ] as never)
      prisma.aiAssistant.findMany.mockResolvedValue([assistantRow({ version: 3 })])
      prisma.aiAssistant.groupBy.mockResolvedValueOnce([{ slug: 'support-bot' }] as never)

      const result = await service.list({ version: 'latest', page: 1, limit: 20 })

      expect(prisma.aiAssistant.groupBy).toHaveBeenCalled()
      expect(result.total).toBe(1)
      expect(result.data[0]!.version).toBe(3)
    })
  })
})
