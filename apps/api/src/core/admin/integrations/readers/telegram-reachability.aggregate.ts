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

/** What one snapshot holds for the reader's own settings. */
interface Partitioned {
  current: Judged[]
  unreadable: number
  otherSettings: number
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

/** Unreadable values are counted, never dropped; results past retention are forgotten. */
function partition(snapshot: TelegramObservationSnapshot, binding: string): Partitioned {
  const out: Partitioned = { current: [], unreadable: 0, otherSettings: 0 }
  for (const [, raw] of snapshot.fields) {
    const observation = parse(raw)
    if (!observation) {
      out.unreadable += 1
      continue
    }
    const age = snapshot.now - observation.observedAt
    if (age > TELEGRAM_REACHABILITY.retentionMs) continue
    if (observation.binding !== binding) out.otherSettings += 1
    else out.current.push({ ...observation, fresh: age <= STALE_MS })
  }
  return out
}

function evidence(
  result: Evidence['result'],
  freshness: Evidence['freshness'],
  checkedAt: string | null,
  failure: string | null
): Evidence {
  return {
    result,
    freshness,
    scope: 'provider_token_check',
    instance: 'workers',
    checkedAt,
    staleAfterSeconds: checkedAt === null ? null : TELEGRAM_REACHABILITY.staleAfterSeconds,
    failure,
  }
}

const newest = (items: Judged[]): Judged =>
  items.reduce((a, b) => (b.observedAt > a.observedAt ? b : a))
const oldest = (items: Judged[]): Judged =>
  items.reduce((a, b) => (b.observedAt < a.observedAt ? b : a))

/** Fresh failed > fresh unknown > stale failed > any stale > all fresh ok. */
function decidingObservation(current: Judged[]): Judged {
  const pick = (fresh: boolean, result?: TelegramObservation['result']): Judged[] =>
    current.filter((o) => o.fresh === fresh && (result === undefined || o.result === result))
  const candidates: [Judged[], (items: Judged[]) => Judged][] = [
    [pick(true, 'failed'), newest],
    [pick(true, 'unknown'), newest],
    [pick(false, 'failed'), newest],
    [pick(false), oldest],
  ]
  for (const [items, choose] of candidates) if (items.length > 0) return choose(items)
  return oldest(current)
}

/**
 * The Telegram row as of one snapshot. Precedence: overflow, unreadable value, nothing for the
 * current settings, then the deciding observation. A row's time is always the real time of the
 * event that decided it, expressed in the API clock (`apiNow - age`) so the browser ages it like
 * every other row; the age itself is exact.
 */
export function aggregateTelegram(
  snapshot: TelegramObservationSnapshot,
  binding: string,
  apiNow: number
): { evidence: Evidence; facts: Facts } {
  const at = (redisTime: number): string =>
    new Date(apiNow - Math.max(0, snapshot.now - redisTime)).toISOString()
  const { current, unreadable, otherSettings } = partition(snapshot, binding)
  const facts = factsOf(current, otherSettings)

  if (snapshot.overflow) {
    const { lastRefusedAt } = snapshot.overflow
    const freshness = snapshot.now - lastRefusedAt <= STALE_MS ? 'fresh' : 'stale'
    return {
      evidence: evidence('unknown', freshness, at(lastRefusedAt), 'too_many_workers'),
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
  const o = decidingObservation(current)
  return {
    evidence: evidence(o.result, o.fresh ? 'fresh' : 'stale', at(o.observedAt), o.failure),
    facts,
  }
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
