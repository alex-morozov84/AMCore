import type { IntegrationEvidence, IntegrationItem } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { evidenceAt, headlineOf } from './headline'

const evidence = (over: Partial<IntegrationEvidence> = {}): IntegrationEvidence => ({
  result: 'none',
  freshness: 'none',
  scope: 'provider_acceptance',
  instance: 'shared',
  checkedAt: null,
  staleAfterSeconds: 3600,
  failure: null,
  ...over,
})
const item = (over: Partial<IntegrationItem> = {}): IntegrationItem => ({
  id: 'email',
  name: 'Email',
  configuration: 'configured',
  source: 'ok',
  evidence: evidence(),
  facts: [],
  links: [],
  action: null,
  ...over,
})
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

describe('headlineOf', () => {
  it('never calls a configured integration without evidence working', () => {
    expect(headlineOf(item(), evidence())).toBe('setUpNotVerified')
  })

  it('keeps a failed result failed when it is stale', () => {
    const failed = evidence({ result: 'failed', freshness: 'stale', failure: 'auth' })
    expect(headlineOf(item({ evidence: failed }), failed)).toBe('failed')
  })

  it('does not report the mock provider as working', () => {
    const simulated = evidence({ result: 'simulated', freshness: 'fresh' })
    expect(headlineOf(item({ evidence: simulated }), simulated)).toBe('simulated')
  })

  it('puts an unreadable source and a switched-off integration first', () => {
    expect(headlineOf(item({ source: 'unavailable' }), evidence({ result: 'ok' }))).toBe(
      'cannotRead'
    )
    expect(headlineOf(item({ configuration: 'disabled' }), evidence({ result: 'ok' }))).toBe('off')
    expect(headlineOf(item({ configuration: 'not_configured' }), evidence())).toBe('notSetUp')
  })

  it('says "check passed", not "working", for a token check; other scopes keep "working"', () => {
    const passed = evidence({ result: 'ok', freshness: 'fresh', scope: 'provider_token_check' })
    expect(headlineOf(item({ id: 'telegram', evidence: passed }), passed)).toBe('checkPassed')
    const old = { ...passed, freshness: 'stale' as const }
    expect(headlineOf(item({ id: 'telegram', evidence: old }), old)).toBe('lastCheckOld')
    const sent = evidence({ result: 'ok', freshness: 'fresh' })
    expect(headlineOf(item({ evidence: sent }), sent)).toBe('working')
  })

  it('distinguishes a test in progress and an unknown outcome', () => {
    expect(headlineOf(item(), evidence({ failure: 'in_progress' }))).toBe('inProgress')
    expect(headlineOf(item(), evidence({ result: 'unknown', freshness: 'fresh' }))).toBe('unknown')
  })
})

describe('evidenceAt', () => {
  const base = evidence({ result: 'ok', freshness: 'fresh', checkedAt: '2026-10-22T11:00:00.000Z' })

  it('ages an observation while the page stays open', () => {
    expect(evidenceAt(base, NOW - 1).freshness).toBe('fresh')
    expect(evidenceAt(base, NOW + 120_000).freshness).toBe('stale')
  })

  it('does not give a configuration-only row a check time or freshness', () => {
    const configOnly = evidence({ scope: 'configuration_only', staleAfterSeconds: null })
    expect(evidenceAt(configOnly, NOW)).toEqual(configOnly)
  })
})
