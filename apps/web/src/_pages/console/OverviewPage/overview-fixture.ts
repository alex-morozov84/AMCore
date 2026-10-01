import type { AdminOverviewResponse } from '@amcore/shared'

/** Independent observation fixture for Console UI states and stories. */
export const overviewFixture: AdminOverviewResponse = {
  readiness: 'ready',
  dependencies: [
    { name: 'database', status: 'up' },
    { name: 'redis', status: 'up' },
    { name: 'disk', status: 'up' },
    { name: 'memory_heap', status: 'up' },
  ],
  version: '1.0.0',
  processRole: 'all',
  checkedAt: '2026-09-30T12:00:00.000Z',
  completedAt: '2026-09-30T12:00:00.020Z',
  build: { id: 'a'.repeat(64), version: '1.0.0', commit: null },
  storage: {
    state: 'healthy',
    driver: 'local',
    checkedAt: '2026-09-30T12:00:00.000Z',
    failure: null,
    stage: null,
    nextScheduledAt: '2026-09-30T12:01:00.000Z',
    inProgress: false,
    intervalSeconds: 60,
    staleAfterSeconds: 180,
  },
  storageHealthEnabled: false,
  api: {
    version: '1.0.0',
    commit: 'sample-commit',
    deploymentId: 'api-rollout-1',
    environment: 'staging',
    runtimeMode: 'production',
  },
  process: {
    instanceId: '123e4567-e89b-42d3-a456-426614174000',
    uptimeSeconds: 42,
    sampledAt: '2026-09-30T12:00:00.010Z',
  },
  resources: {
    pool: {
      status: 'available',
      sampledAt: '2026-09-30T12:00:00.010Z',
      total: 3,
      idle: 2,
      waiting: 0,
      max: 10,
      waitingThreshold: 5,
    },
    memory: {
      status: 'available',
      sampledAt: '2026-09-30T12:00:00.011Z',
      heapUsedBytes: 134217728,
      rssBytes: 268435456,
      readinessHeapLimitBytes: 1073741824,
    },
    filesystem: {
      status: 'available',
      sampledAt: '2026-09-30T12:00:00.012Z',
      path: '/',
      totalBytes: 107374182400,
      availableBytes: 53687091200,
      pressureRatio: 0.5,
      pressureThreshold: 0.9,
    },
  },
}
