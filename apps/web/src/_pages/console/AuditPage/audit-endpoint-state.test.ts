import { afterEach, describe, expect, it, vi } from 'vitest'

import { editAuditEndpoint, knownAuditEndpoint, projectAuditEndpoint } from './audit-endpoint-state'

afterEach(() => vi.unstubAllEnvs())

describe('canonical audit endpoint drafts', () => {
  it.each(['2026-11-01T05:30:00.123Z', '2026-11-01T06:30:00.456Z'])(
    'preserves known fold instant %s through local and UTC projection',
    (instant) => {
      vi.stubEnv('TZ', 'America/New_York')
      const endpoint = knownAuditEndpoint(instant, 'utc')
      const local = projectAuditEndpoint(endpoint, 'local')
      expect(local.text).toMatch(/^2026-11-01T01:30:00/)
      expect(local.instant).toBe(instant)
      expect(local.invalid).toBe(false)
      expect(projectAuditEndpoint(local, 'utc').instant).toBe(instant)
    }
  )

  it('retains invalid gap provenance across a display switch and preserves its sibling', () => {
    vi.stubEnv('TZ', 'America/New_York')
    const invalid = editAuditEndpoint('2026-03-08T02:30:00', 'local')
    expect(invalid.instant).toBeNull()
    expect(projectAuditEndpoint(invalid, 'utc')).toEqual(invalid)
    expect(invalid.editMode).toBe('local')
    expect(invalid.invalid).toBe(true)
    const sibling = knownAuditEndpoint('2026-03-08T08:00:00.123Z', 'local')
    expect(projectAuditEndpoint(sibling, 'utc').instant).toBe(sibling.instant)
    expect(editAuditEndpoint(invalid.text, 'utc').invalid).toBe(false)
  })

  it('rejects new fold input while allowing a known fold instant', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(editAuditEndpoint('2026-11-01T01:30:00', 'local').invalid).toBe(true)
    expect(knownAuditEndpoint('2026-11-01T05:30:00.123Z', 'local').invalid).toBe(false)
  })
})
