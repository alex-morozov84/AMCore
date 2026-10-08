import { jest } from '@jest/globals'

import type { Prisma } from '../../src/generated/prisma/client'
import { AiModelRegistry } from '../../src/infrastructure/ai/registry/ai-model-registry.service'
import type { E2ETestContext } from '../helpers'

import { queuedConsistencyRun } from './ai-consistency-context'
import { drainConsistency, sdkFixture, selectSdkModel } from './ai-sdk-consistency'

export function gatewayBindingProof(getContext: () => E2ETestContext): void {
  describe('frozen descriptor and live admission through producer/SDK/PG', () => {
    beforeEach(() => {
      sdkFixture.reset()
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })
    it('same-row edits keep frozen wire/capabilities/limits while rotation uses current same-slot secret', async () => {
      const context = getContext()
      const selection = await selectSdkModel(context)
      const { run } = await queuedConsistencyRun(context)
      await context.prisma.aiModel.update({
        where: { id: selection.model.id },
        data: {
          providerModelName: 'wire-b',
          capabilities: { text: false },
          maxOutputTokens: 1,
          contextLimit: 1,
        },
      })
      selection.rotate()
      await drainConsistency(context)
      expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'COMPLETED'
      )
      expect(sdkFixture.calls).toHaveLength(1)
      expect(sdkFixture.calls[0]!.body.model).toBe('wire-a')
      expect(sdkFixture.calls[0]!.body.max_tokens).toBe(123)
      expect(sdkFixture.calls[0]!.headers.get('authorization')).toBe(
        'Bearer <fixture-credential-b>'
      )
      expect(sdkFixture.calls[0]!.redirect).toBe('error')
      expect(JSON.stringify(run.modelSnapshot)).not.toContain('fixture-credential')
      expect(JSON.stringify(run.modelSnapshot)).not.toContain('fixture.example')
    })
    it.each(['disable', 'rebind', 'cancel'] as const)(
      'final admission sees %s after fresh catalogue permission, before SDK I/O',
      async (change) => {
        const context = getContext()
        await selectSdkModel(context)
        const assistant = await context.prisma.aiAssistant.create({
          data: {
            slug: 'fixture-assistant',
            displayName: 'Fixture',
            enabled: true,
            modelSelection: { modelSlug: 'fixture-model', fallback: [] },
            allowedModalities: ['text'],
            toolAllowlist: [],
          },
        })
        const { run, conversation } = await queuedConsistencyRun(context, {}, assistant.id)
        const registry = context.app.get(AiModelRegistry)
        const original = registry.resolveLiveModel.bind(registry)
        jest.spyOn(registry, 'resolveLiveModel').mockImplementation(async (...args) => {
          const result = await original(...args)
          if (change === 'disable')
            await context.prisma.aiAssistant.update({
              where: { id: assistant.id },
              data: { enabled: false },
            })
          if (change === 'rebind')
            await context.prisma.aiConversation.update({
              where: { id: conversation.id },
              data: { assistantId: null },
            })
          if (change === 'cancel')
            await context.prisma.aiRun.update({
              where: { id: run.id },
              data: { cancellationRequestedAt: new Date() },
            })
          return result
        })
        await drainConsistency(context)
        const settled = await context.prisma.aiRun.findUniqueOrThrow({
          where: { id: run.id },
          include: { attempts: true },
        })
        expect(settled.status).toBe(change === 'cancel' ? 'CANCELLED' : 'FAILED')
        expect(settled.errorCode).toBe(
          change === 'cancel'
            ? null
            : change === 'disable'
              ? 'assistant_disabled'
              : 'assistant_binding_changed'
        )
        expect(settled.attempts[0]!.ioStartedAt).toBeNull()
        expect(sdkFixture.calls).toHaveLength(0)
      }
    )
    it.each([
      'model-disabled',
      'provider-disabled',
      'model-replaced',
      'provider-replaced',
      'reassigned',
      'type',
      'slot',
      'endpoint',
    ] as const)('refuses %s before transport', async (edit) => {
      const context = getContext()
      const { model, provider } = await selectSdkModel(context)
      const { run } = await queuedConsistencyRun(context)
      if (edit === 'model-disabled')
        await context.prisma.aiModel.update({ where: { id: model.id }, data: { enabled: false } })
      if (edit === 'provider-disabled')
        await context.prisma.aiProvider.update({
          where: { id: provider.id },
          data: { enabled: false },
        })
      if (edit === 'model-replaced') {
        await context.prisma.aiModel.delete({ where: { id: model.id } })
        await context.prisma.aiModel.create({
          data: { ...model, capabilities: { text: true }, priceSnapshot: {}, id: undefined },
        })
      }
      if (edit === 'provider-replaced') {
        await context.prisma.aiProvider.delete({ where: { id: provider.id } })
        const next = await context.prisma.aiProvider.create({
          data: { ...provider, config: {}, id: undefined },
        })
        await context.prisma.aiModel.create({
          data: {
            ...model,
            capabilities: { text: true },
            priceSnapshot: {},
            id: undefined,
            providerId: next.id,
          },
        })
      }
      if (edit === 'reassigned') {
        const next = await context.prisma.aiProvider.create({
          data: { ...provider, config: {}, id: undefined, slug: 'other-provider' },
        })
        await context.prisma.aiModel.update({
          where: { id: model.id },
          data: { providerId: next.id },
        })
      }
      if (edit === 'type' || edit === 'slot' || edit === 'endpoint')
        await context.prisma.aiProvider.update({
          where: { id: provider.id },
          data:
            edit === 'type'
              ? { type: 'OPENAI' }
              : edit === 'slot'
                ? { credentialSlot: 'JWT_SECRET' }
                : { baseUrl: 'https://other.example/v1' },
        })
      await drainConsistency(context)
      expect(
        (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).errorCode
      ).toBe('model_binding_changed')
      expect(sdkFixture.calls).toHaveLength(0)
    })
    it.each([{}, { version: 2 }, { version: 1, modelId: 42 }] as Prisma.InputJsonValue[])(
      'legacy/malformed descriptor fails before provider/tools: %j',
      async (modelSnapshot) => {
        const context = getContext()
        const { run } = await queuedConsistencyRun(context, { modelSnapshot })
        await drainConsistency(context)
        expect(
          (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).errorCode
        ).toMatch(/^model_snapshot_(legacy_unsupported|invalid)$/)
        expect(sdkFixture.calls).toHaveLength(0)
        expect(await context.prisma.aiUsageLedger.count({ where: { runId: run.id } })).toBe(0)
      }
    )
    it('built-in Anthropic ignores arbitrary unused DB URL/config', async () => {
      const context = getContext()
      const { provider } = await selectSdkModel(context, 'ANTHROPIC')
      const { run } = await queuedConsistencyRun(context)
      await context.prisma.aiProvider.update({
        where: { id: provider.id },
        data: { baseUrl: 'http://evil.example/?secret=1', config: ['unused'] },
      })
      await drainConsistency(context)
      expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'COMPLETED'
      )
      expect(sdkFixture.calls[0]!.url).toContain('https://api.anthropic.com/')
    })
    it.each(['OPENAI_COMPATIBLE', 'ANTHROPIC'] as const)(
      'SDK %s 429/503 header reaches durable PG floor without SDK retries',
      async (family) => {
        const context = getContext()
        await selectSdkModel(context, family)
        const { run } = await queuedConsistencyRun(context, { deadlineAt: null })
        sdkFixture.status = family === 'ANTHROPIC' ? 503 : 429
        sdkFixture.header = '120'
        await drainConsistency(context)
        const settled = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
        const floor = settled.providerRetryRestriction as {
          kind: string
          notBefore: string
          observedAt: string
        }
        expect(settled.status).toBe('QUEUED')
        expect(floor.kind).toBe('until')
        expect(
          new Date(floor.notBefore).getTime() - new Date(floor.observedAt).getTime()
        ).toBeGreaterThanOrEqual(120000)
        expect(settled.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
          new Date(floor.notBefore).getTime()
        )
        await drainConsistency(context)
        expect(sdkFixture.calls).toHaveLength(1)
      }
    )
  })
}
