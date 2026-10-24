import { integrationEvidenceSchema, integrationFactSchema } from '@amcore/shared'

import type { TelegramObservation } from '../../../notifications/channels/telegram/telegram-reachability.policy'
import type { TelegramObservationSnapshot } from '../../../notifications/channels/telegram/telegram-reachability.store'

import { aggregateTelegram } from './telegram-reachability.aggregate'

const BINDING = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const REDIS_NOW = 1_800_000_000_000
const API_NOW = REDIS_NOW + 3_000 // the API clock runs 3 s ahead of Redis
const SEC = 1000

function obs(
  ageSeconds: number,
  result: TelegramObservation['result'],
  failure: TelegramObservation['failure'] = null,
  binding = BINDING
): string {
  return JSON.stringify({
    v: 1,
    binding,
    observedAt: REDIS_NOW - ageSeconds * SEC,
    seq: 1,
    result,
    failure,
  } satisfies TelegramObservation)
}

function snapshot(
  values: string[],
  overflow: TelegramObservationSnapshot['overflow'] = null
): TelegramObservationSnapshot {
  return { now: REDIS_NOW, overflow, fields: values.map((v, i) => [`w${i}`, v]) }
}

const apiTime = (ageSeconds: number) => new Date(API_NOW - ageSeconds * SEC).toISOString()

function aggregate(values: string[], overflow?: TelegramObservationSnapshot['overflow']) {
  const out = aggregateTelegram(snapshot(values, overflow ?? null), BINDING, API_NOW)
  integrationEvidenceSchema.parse(out.evidence)
  for (const fact of out.facts) integrationFactSchema.parse(fact)
  return out
}

const fact = (facts: { key: string; value: unknown }[], key: string) =>
  facts.find((f) => f.key === key)?.value

describe('aggregateTelegram', () => {
  it('all fresh ok: ok, fresh, the oldest fresh time, in the API clock', () => {
    const { evidence, facts } = aggregate([obs(10, 'ok'), obs(50, 'ok')])
    expect(evidence).toMatchObject({
      result: 'ok',
      freshness: 'fresh',
      checkedAt: apiTime(50),
      scope: 'provider_token_check',
      instance: 'workers',
      staleAfterSeconds: 210,
      failure: null,
    })
    expect(facts).toEqual([
      { key: 'workers_reporting', value: 2 },
      { key: 'interval_seconds', value: 60 },
    ])
  })

  it('a fresh failure wins and keeps its own time; a newer success does not move it', () => {
    const { evidence, facts } = aggregate([obs(5, 'ok'), obs(40, 'failed', 'unreachable')])
    expect(evidence).toMatchObject({
      result: 'failed',
      freshness: 'fresh',
      checkedAt: apiTime(40),
      failure: 'unreachable',
    })
    expect(fact(facts, 'workers_failed')).toBe(1)
  })

  it('a fresh unknown outranks a stale failure, which still counts in the facts', () => {
    const { evidence, facts } = aggregate([
      obs(300, 'failed', 'timeout'),
      obs(20, 'unknown', 'rate_limited'),
    ])
    expect(evidence).toMatchObject({
      result: 'unknown',
      freshness: 'fresh',
      failure: 'rate_limited',
    })
    expect(fact(facts, 'workers_failed')).toBe(1)
    expect(fact(facts, 'workers_stale')).toBe(1)
  })

  it('a stale failure stays failed and stale beside fresh successes', () => {
    const { evidence } = aggregate([obs(10, 'ok'), obs(400, 'failed', 'auth_rejected')])
    expect(evidence).toMatchObject({
      result: 'failed',
      freshness: 'stale',
      checkedAt: apiTime(400),
      failure: 'auth_rejected',
    })
  })

  it('a stale success of one worker makes the row stale with that oldest time', () => {
    const { evidence } = aggregate([obs(10, 'ok'), obs(500, 'ok')])
    expect(evidence).toMatchObject({ result: 'ok', freshness: 'stale', checkedAt: apiTime(500) })
  })

  it('nothing for the current settings is none; other settings are named, never vouched for', () => {
    const { evidence, facts } = aggregate([obs(10, 'ok', null, OTHER)])
    expect(evidence).toMatchObject({
      result: 'none',
      freshness: 'none',
      checkedAt: null,
      staleAfterSeconds: null,
      failure: 'configuration_changed',
    })
    expect(fact(facts, 'workers_reporting')).toBe(0)
    expect(fact(facts, 'other_settings')).toBe(1)
    expect(aggregate([]).evidence).toMatchObject({ result: 'none', failure: null })
  })

  it('an observation past retention is forgotten', () => {
    expect(aggregate([obs(3_601, 'failed', 'timeout')]).evidence.result).toBe('none')
  })

  it('overflow keeps the row unknown even when only successes are left', () => {
    const overflow = { since: REDIS_NOW - 900 * SEC, lastRefusedAt: REDIS_NOW - 30 * SEC }
    const { evidence } = aggregate([obs(10, 'ok')], overflow)
    expect(evidence).toMatchObject({
      result: 'unknown',
      freshness: 'fresh',
      checkedAt: apiTime(30),
      failure: 'too_many_workers',
    })
    const old = { since: REDIS_NOW - 3000 * SEC, lastRefusedAt: REDIS_NOW - 2000 * SEC }
    expect(aggregate([obs(10, 'ok')], old).evidence.freshness).toBe('stale')
  })

  it.each([
    ['not json'],
    ['{"v":2}'],
    [JSON.stringify({ v: 1, binding: BINDING })],
    ['x'.repeat(600)],
  ])('an unreadable value is never skipped to produce ok: %s', (raw) => {
    const { evidence } = aggregate([obs(10, 'ok'), raw])
    expect(evidence).toMatchObject({ result: 'unknown', failure: 'invalid_observation' })
  })
})
