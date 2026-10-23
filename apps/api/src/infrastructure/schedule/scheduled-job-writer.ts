import type { Prisma } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/index.js'

import { mergeKind, touch } from './scheduled-job-evidence.sql.js'
import type { Anchor, EvidenceKind, RunClock, Snapshot } from './scheduled-job-pending.js'
import { register, type Registration } from './scheduled-job-registration.sql.js'
import { finishRun, startRun, takeRunLock } from './scheduled-job-runs.sql.js'

const KINDS: EvidenceKind[] = ['success', 'partial', 'failure', 'skip']

/** Server-side limits for every recorder transaction; the pool-level timeouts stay as configured. */
const STATEMENT_TIMEOUT_MS = 2000
const LOCK_TIMEOUT_MS = 1000
/** The recorder never queues for a connection: admission has already seen a free one. */
const CONNECTION_WAIT_MS = 500
const TRANSACTION_MS = 5000

/** Adopts a fresh clock sample as the process anchor when the current one is missing or old. */
export interface Anchors {
  adopt(sample: Anchor): Anchor
}

/** One recorder transaction: bounded waits, the database clock read once, one sample returned. */
async function inRecorderTransaction(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient, sample: Anchor) => Promise<void>
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`
        SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
               set_config('lock_timeout', ${String(LOCK_TIMEOUT_MS)}, true),
               clock_timestamp() AS now`
      await work(tx, { db: (clock?.now ?? new Date()).getTime(), mono: performance.now() })
    },
    { maxWait: CONNECTION_WAIT_MS, timeout: TRANSACTION_MS }
  )
}

/** The process's catalogue, reported through the same bounded, admitted write path as evidence. */
export function writeRegistration(prisma: PrismaService, items: Registration[]): Promise<void> {
  return inRecorderTransaction(prisma, async (tx, sample) => {
    await takeRunLock(tx)
    await register(tx, items, new Date(sample.db).toISOString())
  })
}

/**
 * Writes one lane's snapshot in one transaction. Times are converted with the anchor of the run
 * they belong to (database time at the anchor plus the monotonic age since it), so a start, its
 * finish and any retry of one run always carry the same key, and a delayed write never makes an old
 * event look fresh.
 */
export function writeSnapshot(
  prisma: PrismaService,
  snapshot: Snapshot,
  knownJobIds: string[],
  anchors: Anchors
): Promise<void> {
  return inRecorderTransaction(prisma, async (tx, sample) => {
    const toDb = (mono: number, clock: RunClock): string => {
      clock.anchor ??= anchors.adopt(sample)
      return new Date(clock.anchor.db + (mono - clock.anchor.mono)).toISOString()
    }
    const dbNow = new Date(sample.db).toISOString()
    const lost = (jobId: string): void =>
      void snapshot.dropped.set(jobId, (snapshot.dropped.get(jobId) ?? 0) + 1)

    if (snapshot.starts.length > 0 || snapshot.finishes.length > 0) await takeRunLock(tx)
    for (const start of snapshot.starts) {
      const startedAt = toDb(start.startMono, start.clock)
      if (!(await startRun(tx, start, startedAt, dbNow, knownJobIds))) lost(start.jobId)
    }
    for (const finish of snapshot.finishes) {
      const finishedAt = toDb(finish.endMono, finish.clock)
      // A finish without its own run row changes nothing there; the summary below still records it.
      if (!(await finishRun(tx, finish, finishedAt, dbNow))) lost(finish.jobId)
    }
    for (const kind of KINDS) {
      const items = snapshot.evidence.filter((item) => item.kind === kind)
      if (items.length > 0) await tx.$executeRaw(mergeKind(kind, items, toDb))
    }
    const refresh = touch(snapshot.evidence, snapshot.dropped, dbNow)
    if (refresh) await tx.$executeRaw(refresh)
  })
}
