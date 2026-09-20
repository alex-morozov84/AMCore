import type { AdminOverviewDependency } from '@amcore/shared'

/**
 * Every dependency name the API can send (`ADMIN_OVERVIEW_DEPENDENCY_NAMES`
 * in `@amcore/shared`) maps to a human-facing label — a total map, not a
 * fallback-to-raw-name one, since the schema's closed enum makes "an
 * unrecognized name" a type error here, not a runtime case to handle.
 */
export const DEPENDENCY_LABEL_KEY = {
  database: 'overviewDependencyLabelDatabase',
  redis: 'overviewDependencyLabelRedis',
  disk: 'overviewDependencyLabelDisk',
  memory_heap: 'overviewDependencyLabelMemoryHeap',
  storage: 'overviewDependencyLabelStorage',
} as const satisfies Record<AdminOverviewDependency['name'], string>
