import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { CreateAiRunInput } from '@amcore/shared'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../../common/exceptions'

import { AiRunProducerService } from './ai-run-producer.service'

import type { EnvService } from '@/env/env.service'
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
  let env: EnvService
  let logger: DeepMockProxy<PinoLogger>
  let service: AiRunProducerService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    registry = mockDeep<AiModelRegistry>()
    queue = mockDeep<QueueService>()
    env = {
      get: jest.fn((key: string) => (key === 'AI_ARTIFACT_MAX_PARTS_PER_MESSAGE' ? 4 : 33_554_432)),
    } as unknown as EnvService
    logger = mockDeep<PinoLogger>()
    service = new AiRunProducerService(prisma, registry, queue, env, logger)

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

  describe('artifact_ref binding (Arc G)', () => {
    const MULTIMODAL_MODEL: ResolvedAiModel = {
      ...DEFAULT_MODEL,
      capabilities: { structured_output: true, vision: true, pdf: true },
    }
    const CONVERSATION_ROW = [
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE', assistantId: null },
    ]
    const INPUT_WITH_ARTIFACT: CreateAiRunInput = {
      conversationId: 'conv-1',
      inputParts: [
        { type: 'text', text: 'describe this' },
        { type: 'artifact_ref', artifactId: 'art-1' },
      ],
      idempotencyKey: null,
    }

    function artifactRow(overrides: Record<string, unknown> = {}): Record<string, unknown>[] {
      return [{ kind: 'IMAGE', sizeBytes: 1000, boundRunStatus: null, ...overrides }]
    }

    beforeEach(() => {
      registry.resolveDefaultModel.mockResolvedValue(MULTIMODAL_MODEL)
      prisma.aiMessage.create.mockResolvedValue({ id: 'msg-1' } as never)
    })

    it('binds a fresh (never-bound) artifact to the new run and message', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce(artifactRow() as never)

      await service.create('user-1', INPUT_WITH_ARTIFACT)

      expect(prisma.aiArtifact.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['art-1'] }, conversationId: 'conv-1' },
        data: { runId: 'run-1', messageId: 'msg-1' },
      })
    })

    it('allows rebinding an artifact whose bound run is FAILED', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce(artifactRow({ boundRunStatus: 'FAILED' }) as never)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).resolves.toMatchObject({
        id: 'run-1',
      })
    })

    it('allows rebinding an artifact whose bound run is CANCELLED or EXPIRED', async () => {
      for (const status of ['CANCELLED', 'EXPIRED']) {
        prisma.$queryRaw
          .mockResolvedValueOnce(CONVERSATION_ROW as never)
          .mockResolvedValueOnce(artifactRow({ boundRunStatus: status }) as never)
        await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).resolves.toMatchObject({
          id: 'run-1',
        })
      }
    })

    it.each(['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN', 'COMPLETED'])(
      'rejects rebinding an artifact whose bound run is %s (409, no run created)',
      async (status) => {
        prisma.$queryRaw
          .mockResolvedValueOnce(CONVERSATION_ROW as never)
          .mockResolvedValueOnce(artifactRow({ boundRunStatus: status }) as never)

        await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).rejects.toBeInstanceOf(
          ConflictException
        )
        expect(prisma.aiRun.create).not.toHaveBeenCalled()
      }
    )

    it('rejects an unknown/foreign artifact reference (400, no run created)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce([] as never)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it('rejects when the resolved model lacks the required capability (400)', async () => {
      registry.resolveDefaultModel.mockResolvedValue(DEFAULT_MODEL) // no vision/pdf
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce(artifactRow() as never)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it("rejects when the bound assistant's allowedModalities excludes the artifact kind (400)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ ...CONVERSATION_ROW[0], assistantId: 'asst-1' }] as never)
        .mockResolvedValueOnce(artifactRow() as never)
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: true,
        modelSelection: { modelSlug: 'claude-default', fallback: [] },
        allowedModalities: ['text'],
      } as never)
      registry.resolveModel.mockResolvedValue(MULTIMODAL_MODEL)
      registry.hasCredential.mockReturnValue(true)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it("allows the artifact kind when the bound assistant's allowedModalities includes it", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ ...CONVERSATION_ROW[0], assistantId: 'asst-1' }] as never)
        .mockResolvedValueOnce(artifactRow() as never)
      prisma.aiAssistant.findUnique.mockResolvedValue({
        enabled: true,
        modelSelection: { modelSlug: 'claude-default', fallback: [] },
        allowedModalities: ['text', 'image'],
      } as never)
      registry.resolveModel.mockResolvedValue(MULTIMODAL_MODEL)
      registry.hasCredential.mockReturnValue(true)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).resolves.toMatchObject({
        id: 'run-1',
      })
    })

    it('rejects too many artifact references before any artifact lock query (400)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(CONVERSATION_ROW as never)
      const tooMany: CreateAiRunInput = {
        conversationId: 'conv-1',
        inputParts: [
          { type: 'artifact_ref', artifactId: 'a1' },
          { type: 'artifact_ref', artifactId: 'a2' },
          { type: 'artifact_ref', artifactId: 'a3' },
          { type: 'artifact_ref', artifactId: 'a4' },
          { type: 'artifact_ref', artifactId: 'a5' },
        ],
        idempotencyKey: null,
      }

      await expect(service.create('user-1', tooMany)).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1) // only the conversation lock
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it('rejects when referenced artifacts exceed the total per-message byte budget (400)', async () => {
      const twoArtifacts: CreateAiRunInput = {
        conversationId: 'conv-1',
        inputParts: [
          { type: 'artifact_ref', artifactId: 'a1' },
          { type: 'artifact_ref', artifactId: 'a2' },
        ],
        idempotencyKey: null,
      }
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce(artifactRow({ sizeBytes: 20_000_000 }) as never)
        .mockResolvedValueOnce(artifactRow({ sizeBytes: 20_000_000 }) as never)

      await expect(service.create('user-1', twoArtifacts)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it('rejects a single artifact above the aggregate raw-byte cap even though it is within the per-document upload max (base64-overhead regression)', async () => {
      // 26 MB raw is well under the per-document upload ceiling an operator could configure
      // (env-bounded up to 33_554_432) but above AI_ARTIFACT_MAX_TOTAL_RAW_BYTES_PER_MESSAGE
      // (25_165_824 = 32 MiB * 3/4, the reverse of base64's 4/3 expansion) — this is the exact
      // scenario a raw-byte cap set to the encoded 32 MiB ceiling directly would have missed.
      prisma.$queryRaw
        .mockResolvedValueOnce(CONVERSATION_ROW as never)
        .mockResolvedValueOnce(artifactRow({ kind: 'PDF', sizeBytes: 26_000_000 }) as never)

      await expect(service.create('user-1', INPUT_WITH_ARTIFACT)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.aiRun.create).not.toHaveBeenCalled()
    })

    it('does not touch aiArtifact.updateMany for a text-only run (no behavior change)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce(CONVERSATION_ROW as never)

      await service.create('user-1', INPUT)

      expect(prisma.aiArtifact.updateMany).not.toHaveBeenCalled()
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1) // only the conversation lock
    })
  })
})
