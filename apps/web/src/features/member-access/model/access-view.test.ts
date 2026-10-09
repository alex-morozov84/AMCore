import type { MemberAccess } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { capabilityOf, describeRoles, roleNamer, toneOf, wideningNotes } from './access-view'

type Item = MemberAccess['items'][number]
const item = (over: Partial<Item>): Item => ({
  key: 'organization.update',
  baseline: false,
  granted: false,
  reason: 'noGrant',
  actorHint: null,
  origin: null,
  reachedBy: null,
  grantedBy: null,
  vetoedBy: null,
  sources: [],
  sourcesTruncated: false,
  ...over,
})

describe('access view model', () => {
  it('reads each kind of row at a glance', () => {
    expect(toneOf(item({ baseline: true, granted: true }))).toBe('included')
    expect(toneOf(item({ granted: true, reason: 'granted' }))).toBe('allowed')
    expect(toneOf(item({ reason: 'vetoed' }))).toBe('blocked')
    expect(toneOf(item({ reason: 'noGrant' }))).toBe('denied')
    expect(toneOf(item({ reason: null }))).toBe('denied')
  })

  it('splits dotted capability ids from a field suffix, longest id first', () => {
    const ids = ['organization.update', 'organization', 'teamAccess.manage']
    expect(capabilityOf('organization.update', ids)).toEqual({ id: 'organization.update' })
    expect(capabilityOf('organization.update.name', ids)).toEqual({
      id: 'organization.update',
      field: 'name',
    })
    expect(capabilityOf('unknown.thing', ids)).toBeUndefined()
  })

  it('names known roles, labels unknown ones and counts the rest', () => {
    const access = {
      roles: { items: [{ id: 'r1', name: 'Support', isSystem: false }] },
    } as MemberAccess
    const nameOf = roleNamer(access)
    expect(describeRoles({ roleIds: ['r1', 'r9'], total: 7 }, nameOf, 'another role')).toEqual({
      names: ['Support', 'another role'],
      more: 5,
    })
    expect(describeRoles(null, nameOf, 'x')).toEqual({ names: [], more: 0 })
  })

  it('lists the widening notes in reading order and nothing for unknown flags', () => {
    const widening = (breadth: boolean | null, synergy: boolean | null, vetoed: boolean | null) =>
      ({ widening: { status: 'computed', breadth, synergy, vetoed } }) as MemberAccess
    expect(wideningNotes(widening(true, true, true))).toEqual(['breadth', 'synergy', 'vetoed'])
    expect(wideningNotes(widening(null, null, null))).toEqual([])
    expect(wideningNotes(widening(false, true, false))).toEqual(['synergy'])
  })
})
