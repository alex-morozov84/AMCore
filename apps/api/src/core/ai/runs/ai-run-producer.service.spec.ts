import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { CreateAiRunInput } from '@amcore/shared'

import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../../common/exceptions'

import { AiRunProducerService } from './ai-run-producer.service'

import type { AiModelRegistry } from '@/infrastructure/ai/registry/ai-model-registry.service'
import type { ResolvedAiModel } from '@/infrastructure/ai/registry/ai-registry.types'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import type { QueueService } from '@/infrastructure/queue/queue.service'
import type { PrismaService } from '@/prisma'

const DEFAULT_MODEL: ResolvedAiModel = {
  slug: 'claude-default',
  providerModelName: 'claude-opus-4-8',
  capabilities: { structured_output: true },
  contextLimit: 200000,
  maxOutputTokens: 8192,
  isDefault: true,
  provider: {
    slug: 'anthropic',
    type: 'ANTHROPIC',
    baseUrl: null,
    credentialSlot: 'anthropic',
    dataRetentionClass: 'standard',
    config: null,
  },
}

const INPUT: CreateAiRunInput = {
  conversationId: 'conv-1',
  inputParts: [{ type: 'text', text: 'hello' }],
  idempotencyKey: null,
}

function fakeRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    status: 'QUEUED',
    errorCode: null,
    terminalReasonCode: null,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

describe('AiRunProducerService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let registry: DeepMockProxy<AiModelRegistry>
  let queue: DeepMockProxy<QueueService>
  let logger: DeepMockProxy<PinoLogger>
  let service: AiRunProducerService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    registry = mockDeep<AiModelRegistry>()
    queue = mockDeep<QueueService>()
    logger = mockDeep<PinoLogger>()
    service = new AiRunProducerService(prisma, registry, queue, logger)

    registry.resolveDefaultModel.mockResolvedValue(DEFAULT_MODEL)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE' },
    ] as never)
    prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: null } } as never)
    prisma.aiRun.create.mockResolvedValue(fakeRun() as never)
  })

  it('queues a run, persists the USER message at sequence 0, and wakes the worker', async () => {
    const result = await service.create('user-1', INPUT)

    expect(result).toMatchObject({ id: 'run-1', conversationId: 'conv-1', status: 'queued' })
    // The USER turn is bound to its run (runId), so the C.4 worker reads one run's own input.
    expect(prisma.aiMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          runId: 'run-1',
          sequence: 0,
          role: 'USER',
          authorType: 'USER',
          authorUserId: 'user-1',
        }),
      })
    )
    // Run is created before its message (so the message can carry runId).
    expect(prisma.aiRun.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.aiMessage.create.mock.invocationCallOrder[0] ?? Infinity
    )
    expect(queue.add).toHaveBeenCalledWith(
      QueueName.AI_RUNS,
      JobName.AI_RUN_WAKE,
      { runId: 'run-1' },
      expect.objectContaining({ attempts: 1 })
    )
  })

  it('freezes a secret-free model snapshot (no credential slot, base URL, or config)', async () => {
    await service.create('user-1', INPUT)

    const createArg = prisma.aiRun.create.mock.calls[0]?.[0]
    const snapshot = createArg?.data.modelSnapshot as Record<string, unknown>
    expect(snapshot).toMatchObject({ modelSlug: 'claude-default', providerType: 'ANTHROPIC' })
    expect(JSON.stringify(snapshot)).not.toContain('credentialSlot')
    expect(JSON.stringify(snapshot)).not.toContain('baseUrl')
    expect(createArg?.data.maxAttempts).toBe(3)
  })

  it('freezes the conversation ownershipGeneration onto the run (ADR-049 fence, Arc F)', async () => {
    // The FOR UPDATE lock returns the conversation's current generation; the run snapshots it.
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 7, controlledBy: 'BOT', state: 'ACTIVE' },
    ] as never)

    await service.create('user-1', INPUT)

    const createArg = prisma.aiRun.create.mock.calls[0]?.[0]
    expect(createArg?.data.ownershipGeneration).toBe(7)
  })

  it('rejects a new run while a human holds the conversation (409, ADR-049 fence, Arc F)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'PAUSED_FOR_HUMAN' },
    ] as never)

    await expect(service.create('user-1', INPUT)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.aiRun.create).not.toHaveBeenCalled()
    expect(prisma.aiMessage.create).not.toHaveBeenCalled()
  })

  it('rejects a new run on a closed conversation (409)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'CLOSED' },
    ] as never)

    await expect(service.create('user-1', INPUT)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.aiRun.create).not.toHaveBeenCalled()
  })

  it('is idempotent: an existing (conversationId, idempotencyKey) run is replayed, not re-created', async () => {
    prisma.aiRun.findFirst.mockResolvedValue(fakeRun({ id: 'run-existing' }) as never)

    const result = await service.create('user-1', { ...INPUT, idempotencyKey: 'evt-1' })

    expect(result.id).toBe('run-existing')
    expect(prisma.aiRun.create).not.toHaveBeenCalled()
    expect(prisma.aiMessage.create).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('rejects a run on a missing or not-owned conversation (404, no leak)', async () => {
    // The lock query is filtered by owner, so a missing OR not-owned conversation returns no row.
    prisma.$queryRaw.mockResolvedValue([] as never)

    await expect(service.create('user-1', INPUT)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.aiRun.create).not.toHaveBeenCalled()
  })

  it('wake is best-effort: a queue outage does not fail a committed run', async () => {
    queue.add.mockRejectedValue(new Error('redis down'))

    await expect(service.create('user-1', INPUT)).resolves.toMatchObject({ id: 'run-1' })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('fails closed with errorCode model_not_configured when no AI model is configured', async () => {
    registry.resolveDefaultModel.mockResolvedValue(null)

    await expect(service.create('user-1', INPUT)).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      errorCode: 'model_not_configured',
    })
    expect(prisma.aiRun.create).not.toHaveBeenCalled()
  })

  describe('bound assistant model (Arc F.4)', () => {
    beforeEach(() => {
      // The conversation is bound to an assistant; the lock query returns its id.
      prisma.$queryRaw.mockResolvedValue([
        { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE', assistantId: 'asst-1' },
      ] as never)
    })

    it('resolves the bound assistant model (credential-gated), not the default', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: true,
        modelSelection: { modelSlug: 'claude-default', fallback: [] },
      } as never)
      registry.resolveModel.mockResolvedValue(DEFAULT_MODEL)
      registry.hasCredential.mockReturnValue(true)

      await service.create('user-1', INPUT)

      expect(registry.resolveModel).toHaveBeenCalledWith('claude-default')
      expect(registry.resolveDefaultModel).not.toHaveBeenCalled()
      const snapshot = prisma.aiRun.create.mock.calls[0]?.[0]?.data.modelSnapshot as Record<
        string,
        unknown
      >
      expect(snapshot).toMatchObject({ modelSlug: 'claude-default' })
    })

    it('falls through the modelSelection chain to the first credentialed model', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: true,
        modelSelection: { modelSlug: 'gpt-x', fallback: ['claude-default'] },
      } as never)
      registry.resolveModel.mockImplementation((slug: string) =>
        Promise.resolve(slug === 'claude-default' ? DEFAULT_MODEL : { ...DEFAULT_MODEL, slug })
      )
      // The primary has no credential; the fallback does.
      registry.hasCredential.mockImplementation(
        (m: { slug: string }) => m.slug === 'claude-default'
      )

      await service.create('user-1', INPUT)

      const snapshot = prisma.aiRun.create.mock.calls[0]?.[0]?.data.modelSnapshot as Record<
        string,
        unknown
      >
      expect(snapshot).toMatchObject({ modelSlug: 'claude-default' })
    })

    it('rejects a run when the bound assistant is disabled (409)', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: false,
        modelSelection: { modelSlug: 'claude-default', fallback: [] },
      } as never)

      await expect(service.create('user-1', INPUT)).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it('rejects a run when the pinned assistant model has no credential (503, no silent mock)', async () => {
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: true,
        modelSelection: { modelSlug: 'gpt-x', fallback: [] },
      } as never)
      registry.resolveModel.mockResolvedValue({ ...DEFAULT_MODEL, slug: 'gpt-x' })
      registry.hasCredential.mockReturnValue(false)

      await expect(service.create('user-1', INPUT)).rejects.toMatchObject({
        constructor: ServiceUnavailableException,
        errorCode: 'model_not_configured',
      })
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
      expect(registry.resolveDefaultModel).not.toHaveBeenCalled() // never silently falls back
    })
  })
})
