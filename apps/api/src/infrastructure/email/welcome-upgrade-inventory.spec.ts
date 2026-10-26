import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { PrismaClient } from '../../generated/prisma/client'

import { welcomeUpgradeInventory } from './welcome-upgrade-inventory'

function fixture(rows = 0) {
  const scan = jest.fn().mockResolvedValue(['0', []])
  const findMany = jest.fn().mockResolvedValue(
    Array.from({ length: rows }, (_, n) => ({
      jobId: `job-${n}`,
      incarnation: `incarnation-${n}`,
      certainty: 'unknown',
    }))
  )
  return {
    scan,
    findMany,
    client: { scan } as unknown as Redis,
    db: { backgroundEffectEvidence: { findMany } } as unknown as PrismaClient,
    queue: { toKey: (suffix: string) => `amcore:email:${suffix}` } as Queue,
  }
}

describe('Offline inventory pagination', () => {
  it('does not restart a completed broker scan while PG evidence has more pages', async () => {
    const f = fixture(51)
    const page = await welcomeUpgradeInventory(f.client, f.db, f.queue, '0', undefined, {
      broker: true,
    })
    expect(f.scan).not.toHaveBeenCalled()
    expect(page.nextBrokerCursor).toBe('0')
    expect(page.evidence).toHaveLength(50)
    expect(page.nextEvidenceCursor).toBe('incarnation-49')
  })
  it('does not restart completed PG pagination while the broker has more pages', async () => {
    const f = fixture()
    f.scan.mockResolvedValue(['99', []])
    const page = await welcomeUpgradeInventory(f.client, f.db, f.queue, '37', undefined, {
      evidence: true,
    })
    expect(f.findMany).not.toHaveBeenCalled()
    expect(f.scan).toHaveBeenCalledWith('37', 'MATCH', 'amcore:email:*', 'COUNT', 50)
    expect(page.nextBrokerCursor).toBe('99')
    expect(page.nextEvidenceCursor).toBeNull()
  })
})
