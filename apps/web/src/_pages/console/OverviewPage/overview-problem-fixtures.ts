import type { AdminQueue, IntegrationItem, ScheduledJob, WorkSummary } from '@amcore/shared'

import { overviewFixture } from './overview-fixture'
import type { OverviewSources } from './overview-problem-model'

export const OBSERVED = '2026-10-25T12:00:00.000Z'
export const count = (value = 0, truncated = false) => ({ value, truncated })
export function work(over: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id: 'example-work',
    kind: 'durable',
    status: 'available',
    definitionVersion: 1,
    sampledAt: OBSERVED,
    capabilities: [],
    counts: {
      pending: count(),
      due: count(),
      processing: count(),
      failed: count(),
      terminal: count(),
      unresolved: count(),
    },
    ...over,
  }
}
export function queue(
  over: Partial<Extract<AdminQueue, { status: 'available' }>> = {}
): AdminQueue {
  return {
    name: 'example-queue',
    kind: 'work',
    status: 'available',
    inBoard: false,
    sampledAt: OBSERVED,
    paused: false,
    age: { status: 'none' },
    counts: { waiting: 0, prioritized: 0, active: 0, delayed: 0, failed: 0, waitingChildren: 0 },
    ...over,
  }
}
export function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'custom-job',
    family: 'singleton',
    cadence: 'daily',
    schedule: { kind: 'cron', expression: '0 2 * * *', timeZone: 'UTC' },
    config: { state: 'enabled', reportedAt: OBSERVED, scheduleTimeZone: 'UTC' },
    result: { state: 'none' },
    skip: null,
    freshness: { state: 'unknown', dueAt: null },
    lastSuccess: null,
    nextFireAt: null,
    droppedEvents: 0,
    ...over,
  }
}
export function integration(over: Partial<IntegrationItem> = {}): IntegrationItem {
  return {
    id: 'custom_service',
    name: 'Customer service',
    source: 'ok',
    configuration: 'configured',
    evidence: {
      result: 'none',
      freshness: 'none',
      scope: 'configuration_only',
      instance: 'shared',
      checkedAt: null,
      staleAfterSeconds: null,
      failure: null,
    },
    facts: [],
    links: [],
    action: null,
    ...over,
  }
}
export function sources(over: Partial<OverviewSources> = {}): OverviewSources {
  return {
    overview: overviewFixture,
    queues: { checkedAt: OBSERVED, board: { state: 'disabled' }, queues: [] },
    works: [],
    scheduled: { checkedAt: OBSERVED, jobs: [] },
    integrations: { readAt: OBSERVED, items: [] },
    ...over,
  }
}
