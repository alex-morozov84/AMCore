import type { AdminQueue, AdminQueueCounts, AdminQueuesResponse } from '@amcore/shared'

export const CHECKED_AT = '2026-10-03T12:00:00.000Z'

export const noCounts: AdminQueueCounts = {
  waiting: 0,
  prioritized: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  waitingChildren: 0,
}

type AvailableQueue = Extract<AdminQueue, { status: 'available' }>

export function availableQueue(
  name: string,
  overrides: Partial<Omit<AvailableQueue, 'counts'>> & { counts?: Partial<AdminQueueCounts> } = {}
): AdminQueue {
  const { counts, ...rest } = overrides
  return {
    name,
    kind: name === 'email' ? 'work' : name === 'default' ? 'extension' : 'wake',
    inBoard: name !== 'ai-runs',
    status: 'available',
    sampledAt: CHECKED_AT,
    paused: false,
    counts: { ...noCounts, ...counts },
    age: { status: 'none' },
    ...rest,
  }
}

export const unavailableQueue = (name: string): AdminQueue => ({
  name,
  kind: 'wake',
  inBoard: name !== 'ai-runs',
  status: 'unavailable',
})

export const disabledQueue = (name: string): AdminQueue => ({
  name,
  kind: 'extension',
  inBoard: false,
  status: 'disabled',
})

export function summary(
  queues: AdminQueue[],
  checkedAt: string = CHECKED_AT,
  boardState: AdminQueuesResponse['board']['state'] = 'available'
): AdminQueuesResponse {
  return { checkedAt, board: { state: boardState }, queues }
}

/** All four stock queues, one of each interesting state. */
export const mixedSummary = summary([
  availableQueue('email', {
    counts: { waiting: 12, prioritized: 2, active: 2, failed: 3 },
    age: { status: 'sample', seconds: 245, sampled: 14 },
  }),
  availableQueue('default'),
  availableQueue('notifications', {
    paused: true,
    counts: { waiting: 140 },
    age: { status: 'sample', seconds: 7300, sampled: 16 },
  }),
  unavailableQueue('ai-runs'),
])

export const allUnavailableSummary = summary([
  unavailableQueue('email'),
  unavailableQueue('notifications'),
])
