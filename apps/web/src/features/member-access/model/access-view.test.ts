import type { MemberAccess } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import {
  capabilityOf,
  describeRoles,
  groupByArea,
  mergeSources,
  roleNamer,
  splitItems,
  toneOf,
  wideningNotes,
} from './access-view'

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

const IDS = ['organization.read', 'organization.update', 'team.manage']
const CAPS = [
  { id: 'organization.read', subject: 'Organization' },
  { id: 'organization.update', subject: 'Organization' },
  { id: 'team.manage', subject: 'TeamAccess' },
]

describe('splitItems', () => {
  it('hides per-field lines that repeat an allowed operation', () => {
    const { active } = splitItems(
      [
        item({ key: 'organization.update', granted: true, reason: 'granted' }),
        item({ key: 'organization.update.name', granted: true, reason: 'granted' }),
      ],
      IDS
    )
    expect(active.map((entry) => entry.key)).toEqual(['organization.update'])
  })

  it('keeps a blocked field even when the rest of the operation is allowed', () => {
    const { active } = splitItems(
      [
        item({ key: 'organization.update', granted: true, reason: 'granted' }),
        item({ key: 'organization.update.name', reason: 'vetoed' }),
        item({ key: 'organization.update.slug', granted: true, reason: 'granted' }),
      ],
      IDS
    )
    expect(active.map((entry) => entry.key)).toEqual([
      'organization.update',
      'organization.update.name',
    ])
  })

  it('keeps a field the person can edit when the whole operation is not allowed', () => {
    const { active, inactive } = splitItems(
      [
        item({ key: 'organization.update' }),
        item({ key: 'organization.update.name', granted: true, reason: 'granted' }),
        item({ key: 'organization.update.slug' }),
      ],
      IDS
    )
    expect(active.map((entry) => entry.key)).toEqual(['organization.update.name'])
    expect(inactive.map((entry) => entry.key)).toEqual(['organization.update'])
  })

  it('keeps blocked items visible and unallowed ones apart', () => {
    const { active, inactive } = splitItems(
      [
        item({ key: 'organization.update', reason: 'vetoed' }),
        item({ key: 'team.manage', reason: 'noGrant' }),
      ],
      IDS
    )
    expect(active.map((entry) => entry.key)).toEqual(['organization.update'])
    expect(inactive.map((entry) => entry.key)).toEqual(['team.manage'])
  })
})

describe('groupByArea', () => {
  it('groups by the subject of the capability, fields included', () => {
    const groups = groupByArea(
      [
        item({ key: 'organization.update.name' }),
        item({ key: 'team.manage' }),
        item({ key: 'organization.read' }),
      ],
      CAPS
    )
    expect(groups.map(([area, rows]) => [area, rows.length])).toEqual([
      ['Organization', 2],
      ['TeamAccess', 1],
    ])
  })
})

describe('mergeSources', () => {
  const rule = (roleIds: string[], over = {}) => ({
    kind: 'rule' as const,
    via: 'readPrerequisite' as const,
    roleIds,
    permissionId: 'p',
    presetId: null,
    effect: 'allow' as const,
    status: 'contributes' as const,
    ...over,
  })
  it('shows rules that say the same thing once, with all their roles', () => {
    const merged = mergeSources([rule(['a']), rule(['b', 'a']), rule(['c'], { status: 'vetoes' })])
    expect(merged.map((entry) => entry.roleIds)).toEqual([['a', 'b'], ['c']])
  })
})
