import { mockDeep } from 'jest-mock-extended'

import { reconstructRounds } from './ai-run-loop-reconstruct'

import { CUTOFF, ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

describe('Transcript reconstruction cutoff across a pending read', () => {
  it('starts no invocation read when sealed during the steps query', async () => {
    const prisma = mockDeep<PrismaService>()
    const latch = new ShutdownLatch({ warn: jest.fn() }, 'ai.run')
    let markEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    prisma.aiRunStep.findMany.mockImplementation((async () => {
      markEntered()
      await held
      return [{ detail: { invocationId: 'legacy-inv', toolCallId: 'legacy-call' } }]
    }) as never)
    prisma.aiToolInvocation.findMany.mockResolvedValue([] as never)
    const result = reconstructRounds(prisma, 'owned-run', (operation) => latch.run(operation))
    try {
      await entered
      latch.seal()
      release()
      const outcome = await result
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(prisma.aiToolInvocation.findMany).not.toHaveBeenCalled()
      expect(outcome).toBe(CUTOFF)
    } finally {
      latch.seal()
      release()
      await result
    }
  })
})
