import {
  TELEGRAM_REACHABILITY,
  type TelegramObservation,
  telegramObservationSchema,
} from '../../../notifications/channels/telegram/telegram-reachability.policy.js'
import type { TelegramObservationSnapshot } from '../../../notifications/channels/telegram/telegram-reachability.store.js'
import type { IntegrationReading } from '../integration.types.js'

type Evidence = IntegrationReading['evidence']
type Facts = IntegrationReading['facts']

interface Judged extends TelegramObservation {
  fresh: boolean
}

const STALE_MS = TELEGRAM_REACHABILITY.staleAfterSeconds * 1000

function parse(raw: string): TelegramObservation | undefined {
  if (Buffer.byteLength(raw, 'utf8') > TELEGRAM_REACHABILITY.maxValueBytes) return undefined
  try {
    const parsed = telegramObservationSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const newest = (items: Judged[]): Judged =>
  items.reduce((a, b) => (b.observedAt > a.observedAt ? b : a))
const oldest = (items: Judged[]): Judged =>
  items.reduce((a, b) => (b.observedAt < a.observedAt ? b : a))

/**
 * The Telegram row as of one snapshot. Precedence: overflow, unreadable value, nothing for the
 * current settings, then fresh failed > fresh unknown > stale failed > any stale > all fresh ok.
 * A row's time is always the real time of the observation that decided it, expressed in the API
 * clock (`apiNow - age`) so the browser ages it like every other row; the age itself is exact.
 */
export function aggregateTelegram(
  snapshot: TelegramObservationSnapshot,
  binding: string,
  apiNow: number
): { evidence: Evidence; facts: Facts } {
  const at = (redisTime: number): string =>
    new Date(apiNow - Math.max(0, snapshot.now - redisTime)).toISOString()
  const evidence = (
    result: Evidence['result'],
    freshness: Evidence['freshness'],
    checkedAt: string | null,
    failure: string | null
  ): Evidence => ({
    result,
    freshness,
    scope: 'provider_token_check',
    instance: 'workers',
    checkedAt,
    staleAfterSeconds: checkedAt === null ? null : TELEGRAM_REACHABILITY.staleAfterSeconds,
    failure,
  })

  let unreadable = 0
  let otherSettings = 0
  const current: Judged[] = []
  for (const [, raw] of snapshot.fields) {
    const observation = parse(raw)
    if (!observation) {
      unreadable += 1
      continue
    }
    const age = snapshot.now - observation.observedAt
    if (age > TELEGRAM_REACHABILITY.retentionMs) continue
    if (observation.binding !== binding) otherSettings += 1
    else current.push({ ...observation, fresh: age <= STALE_MS })
  }
  const facts = factsOf(current, otherSettings)

  if (snapshot.overflow) {
    const recent = snapshot.now - snapshot.overflow.lastRefusedAt <= STALE_MS
    const time = at(snapshot.overflow.lastRefusedAt)
    return {
      evidence: evidence('unknown', recent ? 'fresh' : 'stale', time, 'too_many_workers'),
      facts,
    }
  }
  if (unreadable > 0)
    return {
      evidence: evidence('unknown', 'fresh', at(snapshot.now), 'invalid_observation'),
      facts,
    }
  if (current.length === 0) {
    const failure = otherSettings > 0 ? 'configuration_changed' : null
    return { evidence: evidence('none', 'none', null, failure), facts }
  }

  const pick = (fresh: boolean, result?: TelegramObservation['result']): Judged[] =>
    current.filter((o) => o.fresh === fresh && (result === undefined || o.result === result))
  const decide = (o: Judged, chooseFreshness: 'fresh' | 'stale'): Evidence =>
    evidence(o.result, chooseFreshness, at(o.observedAt), o.failure)

  const freshFailed = pick(true, 'failed')
  if (freshFailed.length > 0) return { evidence: decide(newest(freshFailed), 'fresh'), facts }
  const freshUnknown = pick(true, 'unknown')
  if (freshUnknown.length > 0) return { evidence: decide(newest(freshUnknown), 'fresh'), facts }
  const staleFailed = pick(false, 'failed')
  if (staleFailed.length > 0) return { evidence: decide(newest(staleFailed), 'stale'), facts }
  const stale = pick(false)
  if (stale.length > 0) return { evidence: decide(oldest(stale), 'stale'), facts }
  return { evidence: decide(oldest(current), 'fresh'), facts }
}

/** Counts for the current settings only; zero counts are left out to keep a healthy row short. */
function factsOf(current: Judged[], otherSettings: number): Facts {
  const failedCount = current.filter((o) => o.result === 'failed').length
  const staleCount = current.filter((o) => !o.fresh).length
  const facts: Facts = [{ key: 'workers_reporting', value: current.length }]
  if (failedCount > 0) facts.push({ key: 'workers_failed', value: failedCount })
  if (staleCount > 0) facts.push({ key: 'workers_stale', value: staleCount })
  if (otherSettings > 0) facts.push({ key: 'other_settings', value: otherSettings })
  facts.push({ key: 'interval_seconds', value: TELEGRAM_REACHABILITY.periodMs / 1000 })
  return facts
}
