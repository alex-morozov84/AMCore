import type { PrismaService } from '../../prisma/index.js'

import { mergeKind, touch } from './scheduled-job-evidence.sql.js'
import type { EvidenceKind, Snapshot } from './scheduled-job-pending.js'
import { finishRun, startRun, takeRunLock } from './scheduled-job-runs.sql.js'

const KINDS: EvidenceKind[] = ['success', 'partial', 'failure', 'skip']

/** Server-side limits for a recorder transaction; the pool-level timeouts stay as configured. */
const STATEMENT_TIMEOUT_MS = 2000
const LOCK_TIMEOUT_MS = 1000
/** The recorder never queues for a connection: admission has already seen a free one. */
const CONNECTION_WAIT_MS = 500
const TRANSACTION_MS = 5000

/**
 * Writes one lane's snapshot in one transaction. Event times are converted to the database clock
 * (db now minus the age measured on the process monotonic clock), so a delayed write does not make
 * an old event look fresh and replicas with different wall clocks stay comparable.
 */
export async function writeSnapshot(
  prisma: PrismaService,
  snapshot: Snapshot,
  knownJobIds: string[]
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`
        SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
               set_config('lock_timeout', ${String(LOCK_TIMEOUT_MS)}, true),
               clock_timestamp() AS now`
      const nowMs = (clock?.now ?? new Date()).getTime()
      const mono = performance.now()
      const toDb = (at: number): string => new Date(nowMs - (mono - at)).toISOString()
      const dbNow = new Date(nowMs).toISOString()

      if (snapshot.starts.length > 0 || snapshot.finishes.length > 0) await takeRunLock(tx)
      for (const start of snapshot.starts) {
        const tracked = await startRun(tx, start, toDb(start.startMono), dbNow, knownJobIds)
        if (!tracked) {
          snapshot.dropped.set(start.jobId, (snapshot.dropped.get(start.jobId) ?? 0) + 1)
        }
      }
      for (const finish of snapshot.finishes) {
        await finishRun(tx, finish, toDb(finish.endMono), dbNow)
      }
      for (const kind of KINDS) {
        const items = snapshot.evidence.filter((item) => item.kind === kind)
        if (items.length > 0) await tx.$executeRaw(mergeKind(kind, items, toDb))
      }
      const refresh = touch(snapshot.evidence, snapshot.dropped, dbNow)
      if (refresh) await tx.$executeRaw(refresh)
    },
    { maxWait: CONNECTION_WAIT_MS, timeout: TRANSACTION_MS }
  )
}
