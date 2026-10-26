import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { BackgroundEffectEvidence, PrismaClient } from '../../generated/prisma/client.js'

interface UpgradeInventory {
  ids: string[]
  nextBrokerCursor: string
  evidence: Pick<
    BackgroundEffectEvidence,
    | 'jobId'
    | 'incarnation'
    | 'policyVersion'
    | 'recipeVersion'
    | 'certainty'
    | 'outcomeRecorded'
    | 'unresolvedCount'
  >[]
  nextEvidenceCursor: string | null
}

/** Offline bounded inventory includes PG-only uncertainty after broker trimming. */
export async function welcomeUpgradeInventory(
  client: Redis,
  db: Pick<PrismaClient, 'backgroundEffectEvidence'>,
  queue: Queue,
  cursor: string,
  after?: string,
  skip: { broker?: boolean; evidence?: boolean } = {}
): Promise<UpgradeInventory> {
  const [nextCursor, keys] = skip.broker
    ? (['0', []] as const)
    : await client.scan(cursor, 'MATCH', `${queue.toKey('')}*`, 'COUNT', 50)
  if (keys.length > 512) throw new Error('READ_LIMIT')
  const ids: string[] = []
  for (const key of keys) {
    const id = key.slice(queue.toKey('').length)
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || (await client.type(key)) !== 'hash') continue
    if ((await client.hstrlen(key, 'name')) > 64) throw new Error('CONTENT_UNSUPPORTED')
    if ((await client.hget(key, 'name')) === 'send-email') ids.push(id)
  }
  const evidence = skip.evidence
    ? []
    : await db.backgroundEffectEvidence.findMany({
        where: { workId: 'email', ...(after ? { incarnation: { gt: after } } : {}) },
        orderBy: { incarnation: 'asc' },
        take: 51,
        select: {
          jobId: true,
          incarnation: true,
          policyVersion: true,
          recipeVersion: true,
          certainty: true,
          outcomeRecorded: true,
          unresolvedCount: true,
        },
      })
  return {
    ids,
    nextBrokerCursor: nextCursor,
    evidence: evidence.slice(0, 50),
    nextEvidenceCursor: evidence.length > 50 ? evidence[49]!.incarnation : null,
  }
}
