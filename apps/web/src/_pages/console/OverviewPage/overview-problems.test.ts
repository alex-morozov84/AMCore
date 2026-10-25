import type { ScheduledJob } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { overviewFixture } from './overview-fixture'
import {
  count,
  integration,
  job,
  OBSERVED,
  queue,
  sources,
  work,
} from './overview-problem-fixtures'
import type { OverviewSources, ProblemCopy } from './overview-problem-model'
import { overviewProblems } from './overview-problems'

const t = ((key: string, values?: unknown) =>
  `${key}:${JSON.stringify(values ?? {})}`) as ProblemCopy
const model = (over: Partial<OverviewSources> = {}) =>
  overviewProblems(sources(over), {
    t,
    locale: 'en',
    name: (_kind, _id, fallback) => fallback,
  })
const facts = (entry: ReturnType<typeof model>['attention'][number]) =>
  entry.facts.map((f) => f.text).join(' ')
const failedResult: ScheduledJob['result'] = {
  state: 'failed',
  startedAt: OBSERVED,
  durationMs: 10,
  code: null,
  summary: null,
}

describe('problem signals and ownership', () => {
  it('separates complete empty, partial empty and all missing', () => {
    expect(model().attention).toHaveLength(0)
    expect(model().gaps).toHaveLength(0)
    expect(model({ scheduled: null }).gaps.map((e) => e.key)).toEqual(['source:scheduled'])
    const empty = model({
      overview: null,
      queues: null,
      works: null,
      scheduled: null,
      integrations: null,
    })
    expect(empty.allUnavailable).toBe(true)
    expect(empty.gaps).toHaveLength(5)
  })
  it.each(['off', 'stale'] as const)('keeps old private exposure first even when %s', (state) => {
    const result = model({
      overview: {
        ...overviewFixture,
        publicDelivery: {
          ...overviewFixture.publicDelivery,
          state,
          checkedAt: OBSERVED,
          failure: 'private_exposed',
        },
      },
      scheduled: { checkedAt: OBSERVED, jobs: [job({ result: failedResult })] },
    })
    expect(result.attention.map((e) => e.key)).toEqual(['files', 'scheduled:custom-job'])
    expect(result.attention[0]).toMatchObject({ priority: 0, metricAt: OBSERVED })
    expect(result.attention[0]!.guide).toContain('#private-exposure')
  })
  it('suppresses ordinary old public failures when off but retains private stale failures', () => {
    const result = model({
      overview: {
        ...overviewFixture,
        publicDelivery: { ...overviewFixture.publicDelivery, failure: 'public_not_served' },
        storage: { ...overviewFixture.storage, state: 'stale', failure: 'access_denied' },
      },
    })
    expect(result.attention).toHaveLength(1)
    expect(facts(result.attention[0]!)).toContain('privateFailed')
    expect(facts(result.attention[0]!)).not.toContain('publicFailed')
    expect(facts(result.attention[0]!)).toContain('old')
  })
  it.each([0, 9])('does not infer a database failure cause from pool waiting=%i', (waiting) => {
    const result = model({
      overview: {
        ...overviewFixture,
        readiness: 'not_ready',
        dependencies: overviewFixture.dependencies.map((d) =>
          d.name === 'database' ? { ...d, status: 'down' } : d
        ),
        resources: {
          ...overviewFixture.resources,
          pool: {
            status: 'available',
            sampledAt: OBSERVED,
            total: 10,
            idle: 0,
            waiting,
            max: 10,
            waitingThreshold: 5,
          },
        },
      },
    })
    expect(result.attention[0]!.guide).toBe('docs/operations/runbooks/db.md#database-check-failed')
  })
  it('keeps independent resource gaps out of readiness failures', () => {
    const result = model({
      overview: {
        ...overviewFixture,
        resources: {
          ...overviewFixture.resources,
          filesystem: { status: 'unavailable', sampledAt: null },
        },
      },
    })
    expect(result.attention).toHaveLength(0)
    expect(facts(result.gaps[0]!)).toContain('resourcesMissing')
  })
  it('keeps file-only readiness in Files and preserves different observation results/times', () => {
    const secondary = integration({
      id: 'storage',
      evidence: {
        ...integration().evidence,
        result: 'failed',
        checkedAt: OBSERVED,
        failure: 'access_denied',
      },
    })
    const result = model({
      overview: {
        ...overviewFixture,
        readiness: 'not_ready',
        storageHealthEnabled: true,
        dependencies: [...overviewFixture.dependencies, { name: 'storage', status: 'down' }],
      },
      integrations: { readAt: OBSERVED, items: [secondary] },
    })
    expect(result.attention.map((e) => e.key)).toEqual(['files'])
    expect(facts(result.attention[0]!)).toContain('different')
    expect(facts(result.attention[0]!)).toContain('privateFailed')
    expect(result.attention[0]!.facts.some((f) => f.at === OBSERVED)).toBe(true)
  })
  it('uses secondary private check only as qualified fallback, never a public verdict', () => {
    const result = model({
      overview: null,
      integrations: {
        readAt: OBSERVED,
        items: [
          integration({
            id: 'storage',
            evidence: { ...integration().evidence, result: 'ok', checkedAt: OBSERVED },
          }),
        ],
      },
    })
    expect(result.attention).toHaveLength(0)
    expect(facts(result.gaps.find((e) => e.key === 'files')!)).toContain('privatePassed')
    expect(facts(result.gaps.find((e) => e.key === 'files')!)).toContain('publicMissing')
  })
  it('does not equate queue identity with work identity or count wake failures as deliveries', () => {
    const q = queue({
      kind: 'wake',
      counts: {
        ...(queue() as Extract<ReturnType<typeof queue>, { status: 'available' }>).counts,
        failed: 3,
      },
    })
    const w = work({
      id: 'notification-deliveries',
      counts: { ...work().counts!, failed: count(7), unresolved: count(2) },
    })
    const result = model({
      queues: { ...sources().queues!, queues: [q] },
      works: [w, work({ kind: 'ordinary', counts: w.counts })],
    })
    expect(result.attention.map((e) => e.key)).toEqual([
      'work:notification-deliveries',
      'queue:example-queue',
    ])
    expect(facts(result.attention[0]!)).toContain('notificationFailed:{"count":"7"}')
    expect(facts(result.attention[0]!)).toContain('unresolved:{"count":"2"}')
    expect(result.attention[0]!.href).not.toContain('state=failed')
    expect(facts(result.attention[1]!)).toContain('wakeFailed:{"count":"3"}')
  })
  it('opens only a proved failed list; truncation is a lower bound and unresolved counts are never added', () => {
    const result = model({
      works: [work({ counts: { ...work().counts!, failed: count(10000, true) } })],
    })
    expect(result.attention[0]!.href).toContain('state=failed')
    expect(facts(result.attention[0]!)).toContain('atLeast')
    const uncertain = model({
      works: [
        work({ counts: { ...work().counts!, failed: count(2), unresolved: count(0, true) } }),
      ],
    })
    expect(uncertain.attention).toHaveLength(1)
    expect(uncertain.attention[0]!.href).not.toContain('state=failed')
    expect(facts(uncertain.attention[0]!)).toContain('countsMissing')
  })
  it('ignores due work alone, disabled old work and pause without pending work', () => {
    expect(
      model({
        works: [
          work({ paused: true, counts: { ...work().counts!, due: count(10) } }),
          work({ id: 'off', status: 'disabled', counts: { ...work().counts!, failed: count(3) } }),
        ],
      }).attention
    ).toHaveLength(0)
    expect(
      model({ works: [work({ paused: true, counts: { ...work().counts!, pending: count(1) } })] })
        .attention[0]!.priority
    ).toBe(4)
  })
  it('keeps queue disagreement as qualified coverage, including unavailable aggregate fallback', () => {
    const item = integration({
      id: 'queue',
      evidence: { ...integration().evidence, result: 'failed', checkedAt: OBSERVED },
    })
    const result = model({ integrations: { readAt: OBSERVED, items: [item] } })
    expect(result.attention).toHaveLength(0)
    expect(facts(result.gaps[0]!)).toContain('queueDifferent')
    const unavailable = model({
      queues: null,
      integrations: { readAt: OBSERVED, items: [{ ...item, source: 'unavailable' }] },
    })
    expect(facts(unavailable.gaps.find((e) => e.key === 'queue:aggregate')!)).toContain(
      'queueUnreadable'
    )
  })
})

describe('scheduled result and freshness are independent', () => {
  it.each(['none', 'success', 'running', 'failed', 'partial', 'unknown'] as const)(
    '%s plus unknown freshness stays one qualified record',
    (state) => {
      const result =
        state === 'none'
          ? { state }
          : state === 'running' || state === 'unknown'
            ? { state, startedAt: OBSERVED }
            : { ...failedResult, state }
      const resultModel = model({ scheduled: { checkedAt: OBSERVED, jobs: [job({ result })] } })
      const entries = [...resultModel.attention, ...resultModel.gaps]
      expect(entries).toHaveLength(1)
      expect(facts(entries[0]!)).toContain('jobFreshnessUnknown')
      expect(facts(entries[0]!)).not.toContain('jobStale')
      expect(entries[0]!.facts.some((f) => f.time === 'due')).toBe(false)
      expect(resultModel.attention.length).toBe(
        ['failed', 'partial', 'unknown'].includes(state) ? 1 : 0
      )
    }
  )
  it('merges partial and stale, preserves due time and custom identity', () => {
    const result = model({
      scheduled: {
        checkedAt: OBSERVED,
        jobs: [
          job({
            result: { ...failedResult, state: 'partial' },
            freshness: { state: 'stale', dueAt: OBSERVED },
          }),
        ],
      },
    })
    expect(result.attention).toHaveLength(1)
    expect(result.attention[0]).toMatchObject({ priority: 2, technicalId: 'custom-job' })
    expect(facts(result.attention[0]!)).toContain('jobPartial')
    expect(facts(result.attention[0]!)).toContain('jobStale')
    expect(result.attention[0]!.facts.find((f) => f.time === 'due')!.at).toBe(OBSERVED)
  })
})

describe('integrations retain probe scope', () => {
  it('keeps token failure even when its scheduled call succeeded; stale failure remains attention', () => {
    const item = integration({
      id: 'telegram',
      evidence: {
        ...integration().evidence,
        result: 'failed',
        freshness: 'stale',
        scope: 'provider_token_check',
        checkedAt: OBSERVED,
      },
    })
    const result = model({
      integrations: { readAt: OBSERVED, items: [item] },
      scheduled: {
        checkedAt: OBSERVED,
        jobs: [
          job({
            result: { ...failedResult, state: 'success' },
            freshness: { state: 'fresh', dueAt: OBSERVED },
          }),
        ],
      },
    })
    expect(result.attention).toHaveLength(1)
    expect(facts(result.attention[0]!)).toContain('tokenFailed')
    expect(facts(result.attention[0]!)).toContain('old')
  })
  it('distinguishes unavailable, disabled, configured unknown and expected missing checks', () => {
    const base = integration()
    const result = model({
      integrations: {
        readAt: OBSERVED,
        items: [
          { ...base, id: 'off', configuration: 'disabled' },
          { ...base, id: 'unread', source: 'unavailable' },
          { ...base, id: 'unknown', evidence: { ...base.evidence, result: 'unknown' } },
          { ...base, id: 'missing', evidence: { ...base.evidence, scope: 'provider_token_check' } },
          base,
        ],
      },
    })
    expect(result.attention).toHaveLength(0)
    expect(result.gaps.map((e) => e.key)).toEqual([
      'integration:unread',
      'integration:unknown',
      'integration:missing',
    ])
    expect(result.limitations).toBe(true)
  })
  it('bounds the complete normal graph to 226 unique object groups', () => {
    const failedCounts = { ...work().counts!, failed: count(1) }
    const result = model({
      overview: {
        ...overviewFixture,
        readiness: 'not_ready',
        dependencies: overviewFixture.dependencies.map((d) =>
          d.name === 'redis' ? { ...d, status: 'down' } : d
        ),
        storage: { ...overviewFixture.storage, state: 'failed', failure: 'access_denied' },
      },
      queues: {
        ...sources().queues!,
        queues: Array.from({ length: 64 }, (_, i) =>
          queue({
            name: `q-${i}`,
            counts: {
              waiting: 0,
              prioritized: 0,
              active: 0,
              delayed: 0,
              failed: 1,
              waitingChildren: 0,
            },
          })
        ),
      },
      works: Array.from({ length: 64 }, (_, i) => work({ id: `w-${i}`, counts: failedCounts })),
      scheduled: {
        checkedAt: OBSERVED,
        jobs: Array.from({ length: 64 }, (_, i) => job({ id: `j-${i}`, result: failedResult })),
      },
      integrations: {
        readAt: OBSERVED,
        items: Array.from({ length: 32 }, (_, i) =>
          integration({
            id: `service_${i}`,
            evidence: { ...integration().evidence, result: 'failed', checkedAt: OBSERVED },
          })
        ),
      },
    })
    expect(result.attention).toHaveLength(226)
    expect(new Set(result.attention.map((e) => e.key)).size).toBe(226)
    expect(result.gaps).toHaveLength(0)
  })
  it('caps defensive queue input and keeps explicit overflow', () => {
    const result = model({
      queues: {
        ...sources().queues!,
        queues: Array.from({ length: 65 }, (_, i) =>
          queue({
            name: `queue-${i}`,
            paused: true,
            counts: {
              waiting: 1,
              prioritized: 0,
              active: 0,
              delayed: 0,
              failed: 0,
              waitingChildren: 0,
            },
          })
        ),
      },
    })
    expect(result.attention).toHaveLength(64)
    expect(result.gaps.map((e) => e.key)).toContain('queues:overflow')
    expect(result.attention.map((e) => e.key)).not.toContain('queue:queue-64')
  })
})
