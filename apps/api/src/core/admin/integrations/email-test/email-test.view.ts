import {
  type IntegrationEvidence,
  PROBE_CLASSES,
  PROBE_PROVIDERS,
  type ProbeReceipt,
} from '@amcore/shared'

import { EMAIL_TEST_POLICY } from './email-test.policy.js'

/** One attempt as stored. Numbers are Redis `TIME` milliseconds; 0 means "not yet". */
export interface StoredAttempt {
  actorId: string
  recipientToken: string
  scopeWitness: string
  provider: ProbeReceipt['provider']
  state: 'reserved' | 'sending' | 'settled'
  outcome: string
  class: string
  reservedAt: number
  sentAt: number
  deadlineAt: number
  settledAt: number
}

/** The latest observation: self-contained, so it survives the attempt key. */
export interface StoredLast extends Omit<StoredAttempt, 'actorId' | 'recipientToken'> {
  attemptId: string
}

type Raw = Record<string, string>
const num = (value: string | undefined): number => {
  const parsed = Number(value ?? '0')
  return Number.isFinite(parsed) ? parsed : 0
}
const state = (value: string | undefined): StoredAttempt['state'] =>
  value === 'sending' || value === 'settled' ? value : 'reserved'
const provider = (value: string | undefined): StoredAttempt['provider'] =>
  PROBE_PROVIDERS.find((candidate) => candidate === value) ?? 'resend'

function common(raw: Raw): Omit<StoredLast, 'attemptId'> {
  return {
    scopeWitness: raw.scopeWitness ?? '',
    provider: provider(raw.provider),
    state: state(raw.state),
    outcome: raw.outcome ?? '',
    class: raw.class ?? '',
    reservedAt: num(raw.reservedAt),
    sentAt: num(raw.sentAt),
    deadlineAt: num(raw.deadlineAt),
    settledAt: num(raw.settledAt),
  }
}

export function parseAttempt(raw: Raw): StoredAttempt | null {
  if (!raw.actorId) return null
  return { actorId: raw.actorId, recipientToken: raw.recipientToken ?? '', ...common(raw) }
}

export function parseLast(raw: Raw): StoredLast | null {
  if (!raw.attemptId) return null
  return { attemptId: raw.attemptId, ...common(raw) }
}

type Timed = Pick<
  StoredLast,
  'state' | 'outcome' | 'class' | 'reservedAt' | 'sentAt' | 'deadlineAt' | 'settledAt'
>
export interface DerivedStatus {
  outcome: ProbeReceipt['outcome']
  class: ProbeReceipt['class']
  terminal: boolean
}

const OUTCOMES = new Set<string>(['accepted', 'simulated', 'refused', 'unknown', 'not_started'])
const classOf = (value: string): ProbeReceipt['class'] =>
  PROBE_CLASSES.find((candidate) => candidate === value) ?? null

/**
 * What a reader may say about an attempt at Redis time `now`. A reservation that never started is
 * "did not start" (a crash there precedes any transport call). A send without a settle becomes
 * unknown after its deadline: uncertainty was persisted before the external call.
 */
export function deriveStatus(record: Timed, now: number): DerivedStatus {
  if (record.state === 'settled') {
    const outcome = OUTCOMES.has(record.outcome)
      ? (record.outcome as ProbeReceipt['outcome'])
      : 'unknown'
    return { outcome, class: classOf(record.class), terminal: true }
  }
  if (record.state === 'reserved')
    return now - record.reservedAt > EMAIL_TEST_POLICY.abandonedAfterMs
      ? { outcome: 'not_started', class: 'abandoned', terminal: true }
      : { outcome: 'in_progress', class: null, terminal: false }
  return now > record.deadlineAt + EMAIL_TEST_POLICY.unknownGraceMs
    ? { outcome: 'unknown', class: 'deadline', terminal: true }
    : { outcome: 'in_progress', class: null, terminal: false }
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** Strict public projection: mapped field by field, never spread from the stored record. */
export function toReceipt(
  attemptId: string,
  record: StoredLast | (StoredAttempt & { attemptId?: never }),
  now: number
): ProbeReceipt {
  const status = deriveStatus(record, now)
  return {
    attemptId,
    state: status.terminal ? 'settled' : record.state,
    outcome: status.outcome,
    class: status.class,
    provider: record.provider,
    reservedAt: iso(record.reservedAt),
    settledAt: record.settledAt > 0 ? iso(record.settledAt) : null,
  }
}

const NO_EVIDENCE: IntegrationEvidence = {
  result: 'none',
  freshness: 'none',
  scope: 'provider_acceptance',
  instance: 'shared',
  checkedAt: null,
  staleAfterSeconds: EMAIL_TEST_POLICY.staleAfterSeconds,
  failure: null,
}

/** Evidence of the email row from the latest observation, bound to the current configuration. */
export function lastToEvidence(
  last: StoredLast | null,
  currentWitness: string,
  now: number
): IntegrationEvidence {
  if (!last) return NO_EVIDENCE
  if (last.scopeWitness !== currentWitness)
    return { ...NO_EVIDENCE, failure: 'configuration_changed' }
  const status = deriveStatus(last, now)
  if (!status.terminal) return { ...NO_EVIDENCE, failure: 'in_progress' }
  if (status.outcome === 'not_started')
    return { ...NO_EVIDENCE, failure: status.class ?? 'not_started' }
  const checkedAtMs = last.settledAt > 0 ? last.settledAt : last.sentAt || last.reservedAt
  const stale = now - checkedAtMs > EMAIL_TEST_POLICY.staleAfterSeconds * 1000
  const result: IntegrationEvidence['result'] =
    status.outcome === 'accepted'
      ? 'ok'
      : status.outcome === 'simulated'
        ? 'simulated'
        : status.outcome === 'refused'
          ? 'failed'
          : 'unknown'
  return {
    ...NO_EVIDENCE,
    result,
    freshness: stale ? 'stale' : 'fresh',
    checkedAt: iso(checkedAtMs),
    failure: status.class,
  }
}
