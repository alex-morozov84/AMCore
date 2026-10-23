import type { IntegrationEvidence, IntegrationItem } from '@amcore/shared'

export type Headline =
  | 'cannotRead'
  | 'off'
  | 'notSetUp'
  | 'failed'
  | 'unknown'
  | 'simulated'
  | 'working'
  | 'lastCheckOld'
  | 'setUpNotVerified'
  | 'inProgress'

/**
 * Age of an observation judged at `now` (server time), so a page that stays open keeps ageing.
 * Without a check time or a threshold the stored freshness is kept.
 */
export function evidenceAt(evidence: IntegrationEvidence, now: number): IntegrationEvidence {
  if (!evidence.checkedAt || evidence.staleAfterSeconds === null) return evidence
  const stale = now - Date.parse(evidence.checkedAt) > evidence.staleAfterSeconds * 1000
  return { ...evidence, freshness: stale ? 'stale' : 'fresh' }
}

/**
 * One word per row for scanning, from independent facts in a documented order. A failed result
 * stays "Failed" when it is stale; the row's own cells still show the age.
 */
export function headlineOf(item: IntegrationItem, evidence: IntegrationEvidence): Headline {
  if (item.source === 'unavailable') return 'cannotRead'
  if (item.configuration === 'disabled') return 'off'
  if (item.configuration === 'not_configured') return 'notSetUp'
  if (evidence.failure === 'in_progress') return 'inProgress'
  switch (evidence.result) {
    case 'failed':
      return 'failed'
    case 'unknown':
      return 'unknown'
    case 'simulated':
      return 'simulated'
    case 'ok':
      return evidence.freshness === 'stale' ? 'lastCheckOld' : 'working'
    default:
      return 'setUpNotVerified'
  }
}
