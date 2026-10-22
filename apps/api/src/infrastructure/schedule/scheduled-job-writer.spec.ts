import type { Anchor, Evidence, RunClock, RunFinish, RunStart } from './scheduled-job-pending'
import { writeSnapshot } from './scheduled-job-writer'

import type { PrismaService } from '@/prisma'

interface Call {
  text: string
  values: unknown[]
}

/**
 * A transaction double: the first query is the clock read, and its answer is controlled so a slow
 * clock read can be simulated. Everything the writer sends is recorded for inspection.
 */
function fakeTransaction(clockDb: () => number) {
  const calls: Call[] = []
  const record = (
    strings: TemplateStringsArray | { strings: string[]; values: unknown[] },
    values: unknown[]
  ) => {
    const text = 'strings' in strings ? strings.strings.join('?') : strings.join('?')
    calls.push({ text, values: 'strings' in strings ? strings.values : values })
    return text
  }
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = record(strings, values)
      if (text.includes('clock_timestamp')) return [{ now: new Date(clockDb()) }]
      if (text.includes('count(*)')) return [{ open: 0n, total: 0n }]
      return []
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      record(strings, values)
      return 1
    }),
  }
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<void>) => work(tx) }
  return { prisma: prisma as unknown as PrismaService, calls }
}

const anchors = () => {
  let anchor: Anchor | null = null
  return {
    adopt: (sample: Anchor): Anchor => {
      anchor ??= sample
      return anchor
    },
  }
}
const clock = (): RunClock => ({ anchor: null })
const iso = (value: unknown): string => String(value)

describe('canonical run key', () => {
  const runClock = clock()
  const start: RunStart = {
    jobId: 'cleanup',
    runId: 'r1',
    startMono: 1000,
    maxRuntimeMs: 1,
    clock: runClock,
  }
  const finish: RunFinish = {
    jobId: 'cleanup',
    runId: 'r1',
    outcome: 'success',
    startMono: 1000,
    endMono: 1500,
    durationMs: 500,
    code: null,
    summary: null,
    clock: runClock,
  }
  const evidence: Evidence = {
    kind: 'success',
    jobId: 'cleanup',
    cadence: 'daily',
    runId: 'r1',
    startMono: 1000,
    endMono: 1500,
    durationMs: 500,
    code: null,
    summary: null,
    skipReason: null,
    dueAt: null,
    configVersion: 'v1',
    nextFireAt: null,
    clock: runClock,
  }
  const snapshot = (over: object) => ({
    lane: 'event' as const,
    evidence: [],
    starts: [],
    finishes: [],
    dropped: new Map<string, number>(),
    ...over,
  })

  it('is the same in the start, the finish and the summary snapshot even when each clock read is delayed differently', async () => {
    const shared = anchors()
    let db = 1_000_000
    const sent: Call[][] = []
    for (const [index, body] of [
      snapshot({ starts: [start] }),
      snapshot({ finishes: [finish] }),
      snapshot({ evidence: [evidence] }),
    ].entries()) {
      // Each flush reads the database clock a different (and growing) time later.
      db += 60_000 + [0, 700, 31][index]!
      const { prisma, calls } = fakeTransaction(() => db)
      await writeSnapshot(prisma, body, ['cleanup'], shared)
      sent.push(calls)
    }
    const insert = sent[0]!.find((call) =>
      call.text.includes('INSERT INTO core.scheduled_job_runs')
    )
    const closing = sent[1]!.find((call) =>
      call.text.includes('UPDATE core.scheduled_job_runs SET')
    )
    const summary = sent[2]!.find((call) => call.text.includes('"successStartedAt" = v.started'))
    const startedAt = iso(insert?.values[2])
    // Start insert: its startedAt. Finish update: finishedAt = start + 500 ms. Summary: both.
    expect(startedAt).toMatch(/^\d{4}-/)
    expect(iso(closing?.values[1])).toBe(new Date(Date.parse(startedAt) + 500).toISOString())
    const arrays = (summary?.values ?? []).filter(Array.isArray) as unknown[][]
    expect(arrays.map((values) => values.map(iso))).toContainEqual([startedAt])
    expect(arrays.map((values) => values.map(iso))).toContainEqual([
      new Date(Date.parse(startedAt) + 500).toISOString(),
    ])
  })

  it('stays the same when the same snapshot is delivered again after an unknown commit', async () => {
    const shared = anchors()
    let db = 5_000_000
    const first = fakeTransaction(() => db)
    await writeSnapshot(first.prisma, snapshot({ evidence: [evidence] }), ['cleanup'], shared)
    db += 90_000
    const second = fakeTransaction(() => db)
    await writeSnapshot(second.prisma, snapshot({ evidence: [evidence] }), ['cleanup'], shared)
    const startedOf = (calls: Call[]) =>
      iso(
        (
          calls.find((call) => call.text.includes('"successStartedAt" = v.started'))
            ?.values[1] as unknown[]
        )[0]
      )
    expect(startedOf(first.calls)).toBe(startedOf(second.calls))
  })
})
