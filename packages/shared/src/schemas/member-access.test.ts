import { describe, expect, it } from 'vitest'

import {
  type AccessArea,
  type AccessConfiguredItem,
  accessItemSchema,
  type AccessLimit,
  accessRecordItemSchema,
  memberAccessSchema,
} from './member-access'
import { ACCESS_AREAS_MAX, ACCESS_CONFIGURED_SOURCES_PER_ITEM } from './member-access-budget'

const refs = { roleIds: ['r1'], total: 1 }
const area = (over: Partial<AccessArea> = {}): AccessArea => ({
  kind: 'all',
  roles: refs,
  fields: null,
  prerequisite: 'met',
  masked: false,
  absorbed: false,
  ...over,
})
const rule = (over: Record<string, unknown> = {}) => ({
  kind: 'rule' as const,
  via: 'direct' as const,
  roleIds: ['r1'],
  permissionId: 'p1',
  presetId: null,
  effect: 'allow' as const,
  status: 'contributes' as const,
  area: 'all' as const,
  prerequisite: 'met' as const,
  ...over,
})
const configured = (over: Partial<AccessConfiguredItem> = {}): AccessConfiguredItem => ({
  key: 'fixtureOrder.update',
  evaluation: 'configured',
  baseline: false,
  state: 'allowed',
  areas: [area()],
  limits: [],
  blockedBy: null,
  sources: [rule()],
  sourcesTruncated: false,
  ...over,
})
const limit = (kind: AccessLimit['kind'], fields?: string[]): AccessLimit => ({
  kind,
  ...(fields && { fields }),
})
const parses = (item: unknown) => accessItemSchema.safeParse(item).success

describe('configured item state matrix', () => {
  it('rejects a met area contradicted by a contributing source prerequisite', () => {
    expect(parses(configured({ sources: [rule({ prerequisite: 'unproven' })] }))).toBe(false)
    expect(parses(configured({ sources: [rule({ prerequisite: 'missing' })] }))).toBe(false)
    expect(parses(configured())).toBe(true)
  })

  it('rejects blocked items without a blocking deny or with an empty blocker set', () => {
    const blocked = configured({
      state: 'blocked',
      blockedBy: refs,
      areas: [area({ masked: true })],
    })
    expect(parses(blocked)).toBe(false)
    const source = rule({ effect: 'deny', status: 'vetoes', area: null, prerequisite: null })
    expect(parses({ ...blocked, sources: [source] })).toBe(true)
    expect(parses({ ...blocked, sources: [rule({ status: 'overridden' })] })).toBe(true)
    expect(parses({ ...blocked, sources: [source], blockedBy: { roleIds: [], total: 0 } })).toBe(
      false
    )
  })
  it.each([
    ['allowed: one unlimited area all, nothing else', configured()],
    [
      'allowed: other areas are absorbed and add no limits',
      configured({
        areas: [
          area(),
          area({ kind: 'own', absorbed: true }),
          area({ kind: 'custom', absorbed: true }),
        ],
      }),
    ],
    [
      'configured: a conditional area only',
      configured({ state: 'configured', areas: [area({ kind: 'own' })] }),
    ],
    [
      'configured: a field-limited all area carries its limit',
      configured({
        state: 'configured',
        areas: [area({ fields: ['status'] })],
        limits: [limit('fields', ['status'])],
      }),
    ],
    [
      'configured: own and assigned stay independent areas',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own' }), area({ kind: 'assigned', prerequisite: 'unproven' })],
      }),
    ],
    [
      'configured: a masked area next to an unmasked usable one',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own', masked: true }), area({ kind: 'assigned' })],
        limits: [limit('denyCondition')],
      }),
    ],
    [
      'blocked: every area masked, blocked by a deny',
      configured({
        state: 'blocked',
        areas: [area({ kind: 'own', masked: true })],
        blockedBy: refs,
        sources: [rule({ effect: 'deny', status: 'vetoes', area: null, prerequisite: null })],
      }),
    ],
    [
      'missingPrerequisite: every unmasked area lacks the read; a masked one is ignored',
      configured({
        state: 'missingPrerequisite',
        areas: [
          area({ kind: 'own', prerequisite: 'missing' }),
          area({ kind: 'assigned', prerequisite: 'met', masked: true }),
        ],
      }),
    ],
    ['none: nothing at all', configured({ state: 'none', areas: [], sources: [] })],
  ])('accepts %s', (_name, item) => {
    expect(parses(item)).toBe(true)
  })

  it.each([
    ['none with an area', configured({ state: 'none', areas: [area()], sources: [] })],
    ['none with a source', configured({ state: 'none', areas: [] })],
    [
      'blocked without blockedBy',
      configured({ state: 'blocked', areas: [area({ masked: true })] }),
    ],
    ['blocked without areas', configured({ state: 'blocked', areas: [], blockedBy: refs })],
    [
      'missingPrerequisite with an unmasked area that is not missing',
      configured({
        state: 'missingPrerequisite',
        areas: [area({ kind: 'own', prerequisite: 'missing' }), area({ kind: 'assigned' })],
      }),
    ],
    [
      'missingPrerequisite with no unmasked area',
      configured({
        state: 'missingPrerequisite',
        areas: [area({ prerequisite: 'missing', masked: true })],
      }),
    ],
    [
      'configured when every unmasked area is missing the prerequisite',
      configured({ state: 'configured', areas: [area({ kind: 'own', prerequisite: 'missing' })] }),
    ],
    [
      'configured with no usable unmasked area',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own', prerequisite: 'blocked' })],
      }),
    ],
    ['configured with blockedBy', configured({ state: 'configured', blockedBy: refs })],
    [
      'configured with an absorbed area',
      configured({ state: 'configured', areas: [area({ absorbed: true })] }),
    ],
    ['allowed with limits', configured({ limits: [limit('condition')] })],
    [
      'allowed with a second area that is not absorbed',
      configured({ areas: [area(), area({ kind: 'own' })] }),
    ],
    [
      'allowed with a masked area',
      configured({ areas: [area(), area({ kind: 'own', masked: true })] }),
    ],
    ['allowed with a limited field list', configured({ areas: [area({ fields: ['status'] })] })],
    [
      'allowed with prerequisite unproven',
      configured({ areas: [area({ prerequisite: 'unproven' })] }),
    ],
    ['allowed on a conditional kind', configured({ areas: [area({ kind: 'own' })] })],
    [
      'an area both masked and absorbed',
      configured({ areas: [area(), area({ kind: 'own', masked: true, absorbed: true })] }),
    ],
    [
      'two areas of the same kind',
      configured({ state: 'configured', areas: [area({ kind: 'own' }), area({ kind: 'own' })] }),
    ],
    [
      'two limits of the same cause',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own' })],
        limits: [limit('condition'), limit('condition')],
      }),
    ],
    [
      'a fields limit without its fields',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own' })],
        limits: [limit('fields')],
      }),
    ],
    [
      'a condition limit that lists fields',
      configured({
        state: 'configured',
        areas: [area({ kind: 'own' })],
        limits: [limit('condition', ['x'])],
      }),
    ],
    [
      'more areas than kinds',
      configured({
        state: 'configured',
        areas: Array.from({ length: ACCESS_AREAS_MAX + 1 }, () => area({ kind: 'own' })),
      }),
    ],
    [
      'more sources than shown for a configured item',
      configured({
        sources: Array.from({ length: ACCESS_CONFIGURED_SOURCES_PER_ITEM + 1 }, () => rule()),
      }),
    ],
  ])('rejects %s', (_name, item) => {
    expect(parses(item)).toBe(false)
  })
})

describe('evaluations stay apart', () => {
  it('a configured item never carries a granted flag', () => {
    expect(parses({ ...configured(), granted: true })).toBe(false)
  })

  it('a record item needs its granted flag and never a configured state', () => {
    const record = {
      key: 'organization.update',
      evaluation: 'record',
      baseline: false,
      granted: true,
      reason: 'granted',
      actorHint: null,
      origin: 'single',
      reachedBy: refs,
      grantedBy: null,
      vetoedBy: null,
      sources: [],
      sourcesTruncated: false,
    }
    expect(accessRecordItemSchema.safeParse(record).success).toBe(true)
    expect(parses({ ...record, granted: null })).toBe(false)
    expect(parses({ ...record, state: 'allowed' })).toBe(false)
  })

  it('a not evaluated item is its own variant and carries nothing else', () => {
    const base = {
      key: 'fixtureOrder.read',
      evaluation: 'notEvaluated',
      baseline: false,
      reason: 'optOut',
      sources: [],
      sourcesTruncated: false,
    }
    expect(parses(base)).toBe(true)
    expect(parses({ ...base, reason: 'noGrant' })).toBe(false)
    expect(parses({ ...base, granted: false })).toBe(false)
    expect(parses({ ...base, sources: [rule()] })).toBe(false)
  })
})

describe('memberAccessSchema', () => {
  const response = (items: unknown[], widening: Record<string, unknown> = {}) => ({
    member: { memberId: 'm1', userId: 'u1', name: null, email: 'a@example.test' },
    aclVersion: 1,
    scope: 'organization-membership',
    roles: { total: 0, items: [], truncated: false },
    unsafeLinkCount: 0,
    items,
    widening: {
      status: 'computed',
      scope: 'exactItems',
      excludedItems: 0,
      breadth: false,
      synergy: false,
      vetoed: false,
      ...widening,
    },
    uncovered: { ruleCount: 0, roleSample: [] },
    qualifiers: [],
  })

  it('declares which items the widening flags consider', () => {
    expect(
      memberAccessSchema.safeParse(response([configured()], { excludedItems: 1 })).success
    ).toBe(true)
    const withoutScope = response([]) as { widening: Record<string, unknown> }
    delete withoutScope.widening.scope
    expect(memberAccessSchema.safeParse(withoutScope).success).toBe(false)
    expect(memberAccessSchema.safeParse(response([], { scope: 'allItems' })).success).toBe(false)
  })
})
