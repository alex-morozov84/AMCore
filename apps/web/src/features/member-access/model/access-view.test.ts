import type { AccessConfiguredItem, AccessRecordItem, MemberAccess } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import {
  capabilityOf,
  configuredWhy,
  describeRoles,
  explainWhy,
  groupByArea,
  mergeSources,
  roleNamer,
  splitItems,
  summaryCounts,
  toneOf,
  wideningNotes,
} from './access-view'

type Item = AccessRecordItem
const item = (over: Partial<Item>): Item => ({
  evaluation: 'record',
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

describe('explainWhy', () => {
  const rule = (roleIds: string[], over = {}) => ({
    kind: 'rule' as const,
    via: 'direct' as const,
    roleIds,
    permissionId: 'p',
    presetId: null,
    effect: 'allow' as const,
    status: 'contributes' as const,
    ...over,
  })
  it('names who allows and who blocks, and leaves met prerequisites out', () => {
    const why = explainWhy(
      item({
        granted: true,
        reason: 'granted',
        sources: [rule(['a']), rule(['a', 'b'], { via: 'readPrerequisite' })],
      })
    )
    expect(why).toEqual({ allows: [{ roleIds: ['a'] }], blocks: [], needs: [] })
  })

  it('counts an overruled allow as an allow and a veto as a block', () => {
    const why = explainWhy(
      item({
        reason: 'vetoed',
        sources: [
          rule(['c'], { status: 'overridden' }),
          rule(['s'], { effect: 'deny', status: 'vetoes' }),
          rule(['d'], { effect: 'deny', status: 'vetoes', via: 'teamAccessVeto' }),
        ],
      })
    )
    expect(why.allows).toEqual([{ roleIds: ['c'] }])
    expect(why.blocks).toEqual([{ roleIds: ['s'] }, { roleIds: ['d'], via: 'teamAccessVeto' }])
  })

  it('shows the prerequisites only when one is missing', () => {
    const why = explainWhy(
      item({
        reason: 'missingPrerequisite',
        sources: [rule(['a']), rule(['a'], { via: 'teamAccessGate' })],
      })
    )
    expect(why.needs).toEqual([{ roleIds: ['a'], via: 'teamAccessGate' }])
  })
})

const refs = { roleIds: ['r1'], total: 1 }
const configured = (over: Partial<AccessConfiguredItem> = {}): AccessConfiguredItem => ({
  key: 'order.update',
  evaluation: 'configured',
  baseline: false,
  state: 'configured',
  areas: [
    { kind: 'own', roles: refs, fields: null, prerequisite: 'met', masked: false, absorbed: false },
  ],
  limits: [],
  blockedBy: null,
  sources: [],
  sourcesTruncated: false,
  ...over,
})
const notEvaluated = (key: string) => ({
  key,
  evaluation: 'notEvaluated' as const,
  baseline: false as const,
  reason: 'optOut' as const,
  sources: [],
  sourcesTruncated: false as const,
})
const ORDER_IDS = ['order.update', 'order.read']

describe('configured and not evaluated items', () => {
  it('reads each state at a glance, and never calls "not evaluated" a refusal', () => {
    expect(toneOf(configured({ state: 'allowed' }))).toBe('allowed')
    expect(toneOf(configured())).toBe('configured')
    expect(toneOf(configured({ state: 'blocked' }))).toBe('blocked')
    expect(toneOf(configured({ state: 'missingPrerequisite' }))).toBe('ineffective')
    expect(toneOf(configured({ state: 'none' }))).toBe('denied')
    expect(toneOf(notEvaluated('order.archive'))).toBe('unknown')
  })

  it('lists what is configured or blocked, keeps what is not given apart and not evaluated alone', () => {
    const parts = splitItems(
      [
        configured({ key: 'order.update' }),
        configured({ key: 'order.read', state: 'none', areas: [] }),
        configured({ key: 'order.update.note', state: 'none', areas: [] }),
        notEvaluated('order.archive'),
      ],
      [...ORDER_IDS, 'order.archive']
    )
    expect(parts.active.map((entry) => entry.key)).toEqual(['order.update'])
    expect(parts.inactive.map((entry) => entry.key)).toEqual(['order.read'])
    expect(parts.notEvaluated.map((entry) => entry.key)).toEqual(['order.archive'])
  })

  it('counts allowed, configured and blocked separately', () => {
    expect(
      summaryCounts([
        configured({ state: 'allowed' }),
        configured(),
        configured({ state: 'blocked' }),
        configured({ state: 'missingPrerequisite' }),
        item({ granted: true, reason: 'granted' }),
        item({ reason: 'vetoed' }),
        item({ baseline: true, granted: true, reason: 'granted' }),
      ])
    ).toEqual({ allowed: 2, configured: 1, blocked: 3 })
  })

  it('words the rules by area and cause without merging areas', () => {
    const rule = (over: Record<string, unknown>) => ({
      kind: 'rule' as const,
      via: 'direct' as const,
      roleIds: ['r1'],
      permissionId: 'p',
      presetId: null,
      effect: 'allow' as const,
      status: 'contributes' as const,
      area: 'own' as const,
      prerequisite: 'met' as const,
      ...over,
    })
    const lines = configuredWhy(
      configured({
        sources: [
          rule({ effect: 'deny', status: 'vetoes', area: null }),
          rule({ effect: 'deny', status: 'restricts', area: null, roleIds: ['r2'] }),
          rule({ status: 'overridden', roleIds: ['r3'] }),
          rule({ area: 'assigned', roleIds: ['r4'] }),
          rule({ area: 'own', roleIds: ['r5'] }),
        ],
      })
    )
    expect(lines.map((line) => [line.kind, line.area, line.roleIds])).toEqual([
      ['blocks', null, ['r1']],
      ['restricts', null, ['r2']],
      ['overridden', 'own', ['r3']],
      ['allows', 'assigned', ['r4']],
      ['allows', 'own', ['r5']],
    ])
  })
})
