import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../../prisma/seed-ai-catalog'
import { AiRunProducerService } from '../../src/core/ai/runs/ai-run-producer.service'
import type { AiConversation, AiRun, Prisma, User } from '../../src/generated/prisma/client'
import { AiModelRegistry } from '../../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../../src/infrastructure/ai/runs/ai-run.repository'
import { cleanDatabase, type E2ETestContext } from '../helpers'

import { closeManagedWorker } from './background-work/close-managed-worker'

/** Disable only suite-owned wake/pollers; recovery fixtures explicitly exercise the PG authority. */
export async function stopConsistencyWake(context: E2ETestContext): Promise<void> {
  for (const job of context.app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
    job.stop()
  await closeManagedWorker(context.app, 'ai-runs')
}

export async function resetConsistencyData(context: E2ETestContext): Promise<void> {
  await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  await seedAiCatalog(context.prisma)
  await context.app.get(AiModelRegistry, { strict: false }).invalidate()
}

export async function queuedConsistencyRun(
  context: E2ETestContext,
  data: Prisma.AiRunUpdateInput = {},
  assistantId?: string
): Promise<{ run: AiRun; conversation: AiConversation; user: User }> {
  const prisma = context.prisma
  const email = `consistency-${crypto.randomUUID()}@example.com`
  const user = await prisma.user.create({
    data: { email, emailCanonical: email, passwordHash: 'x' },
  })
  const conversation = await prisma.aiConversation.create({
    data: { ownerUserId: user.id, assistantId },
  })
  const run = await context.app.get(AiRunProducerService, { strict: false }).create(user.id, {
    conversationId: conversation.id,
    inputParts: [{ type: 'text', text: 'hello' }],
  })
  if (Object.keys(data).length) await prisma.aiRun.update({ where: { id: run.id }, data })
  return {
    run: await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }),
    conversation,
    user,
  }
}

export function consistencyRepository(context: E2ETestContext): AiRunRepository {
  return context.app.get(AiRunRepository, { strict: false })
}
