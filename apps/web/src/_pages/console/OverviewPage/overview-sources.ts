import { fetchConsoleBackgroundWork } from '@/shared/api/console/background-work'
import { fetchConsoleIntegrations } from '@/shared/api/console/integrations'
import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { fetchConsoleQueues } from '@/shared/api/console/queues'
import { fetchConsoleScheduledJobs } from '@/shared/api/console/scheduled-jobs'
import { type DataOutcome, degradeSecondary } from '@/shared/api/server'

import 'server-only'

async function read<T>(work: Promise<DataOutcome<T>>, source: string) {
  const raw = await work
  const retryUntil =
    raw.status === 'unavailable' && raw.retryAfterMs ? Date.now() + raw.retryAfterMs : 0
  const outcome = degradeSecondary(raw, { source })
  return { data: outcome.status === 'available' ? outcome.data : null, retryUntil }
}
/** Independent typed reads. Only known availability degrades; auth/schema errors still throw. */
export async function readOverviewSources() {
  const [overview, queues, works, scheduled, integrations] = await Promise.all([
    read(fetchConsoleOverview(), 'console-overview'),
    read(fetchConsoleQueues(), 'console-overview-queues'),
    read(fetchConsoleBackgroundWork(), 'console-overview-work'),
    read(fetchConsoleScheduledJobs(), 'console-overview-scheduled'),
    read(fetchConsoleIntegrations(), 'console-overview-integrations'),
  ])
  const now = Date.now()
  return {
    sources: {
      overview: overview.data,
      queues: queues.data,
      works: works.data,
      scheduled: scheduled.data,
      integrations: integrations.data,
    },
    retryAfterMs: Math.max(
      0,
      ...[overview, queues, works, scheduled, integrations].map((item) => item.retryUntil - now)
    ),
    renderId: String(now),
  }
}
