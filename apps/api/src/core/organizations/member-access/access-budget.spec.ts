import {
  ACCESS_API_RESPONSE_BYTES,
  ACCESS_MAX_ITEMS,
  ACCESS_RESPONSE_BYTES,
  type MemberAccess,
  memberAccessSchema,
  ROLE_ENVELOPE_RESERVE_BYTES,
  serializedJsonBytes,
} from '@amcore/shared'

import { AccessOperationBudget, AccessUnavailableError } from './access-budget'
import {
  type AccessCapability,
  assertCatalogueWithinLimits,
  countItemSpecs,
} from './access-capabilities'
import { explainAccess } from './access-evaluator'
import { input, ORDER_UPDATE, orderCapabilities, orderPresetRule, rule } from './access-fixtures'
import { assertResponseWithinCap } from './member-access.service'

const capability = (id: string, fields = 0): AccessCapability => ({
  ...ORDER_UPDATE,
  id,
  editableFields: Array.from({ length: fields }, (_, index) => `f${index}`),
})

describe('the operation budget', () => {
  it('counts by category and aborts the moment the limit is passed', () => {
    const budget = new AccessOperationBudget(10)
    budget.spend(4, 'relevance')
    budget.spend(5, 'mask')
    expect(budget.spent).toBe(9)
    expect(budget.spentIn('mask')).toBe(5)
    expect(() => budget.spend(2, 'prerequisite')).toThrow(
      expect.objectContaining({ reason: 'operationBudget', category: 'prerequisite' })
    )
  })

  const roles = [
    {
      id: 'R',
      rules: [
        orderPresetRule('rd', 'read', 'all'),
        orderPresetRule('up', 'update', 'own'),
        orderPresetRule('ua', 'update', 'assigned'),
      ],
    },
  ]

  it('aborts inside every category, returning nothing, whatever the limit', () => {
    const probe = new AccessOperationBudget(Number.MAX_SAFE_INTEGER)
    explainAccess(input(roles, { capabilities: orderCapabilities(), budget: probe }))
    const categories = ['relevance', 'prerequisite', 'mask', 'canonical', 'aggregate'] as const
    for (const category of categories) expect(probe.spentIn(category)).toBeGreaterThan(0)
    const failures: AccessUnavailableError[] = []
    for (let limit = 0; limit < probe.spent; limit += 1) {
      try {
        explainAccess(
          input(roles, {
            capabilities: orderCapabilities(),
            budget: new AccessOperationBudget(limit),
          })
        )
      } catch (error) {
        failures.push(error as AccessUnavailableError)
      }
    }
    expect(failures.every((error) => error.reason === 'operationBudget')).toBe(true)
    expect([...new Set(failures.map((error) => error.category))].sort()).toEqual(
      [...categories].sort()
    )
  })

  it('every unit spent is accounted for by a category', () => {
    const budget = new AccessOperationBudget()
    explainAccess(input(roles, { capabilities: orderCapabilities(), budget }))
    const categories = ['relevance', 'prerequisite', 'mask', 'canonical', 'aggregate'] as const
    expect(categories.reduce((sum, name) => sum + budget.spentIn(name), 0)).toBe(budget.spent)
  })
})

describe('the size of the catalogue is limited before anything is loaded', () => {
  const catalogueOf = (specs: number): AccessCapability[] => {
    // one operation plus (n) fields each: 1 + 4 = 5 specs per capability
    const full = Math.floor(specs / 5)
    return [
      ...Array.from({ length: full }, (_, index) => capability(`c${index}`, 4)),
      ...(specs % 5 > 0 ? [capability('rest', (specs % 5) - 1)] : []),
    ]
  }

  it('counts operations plus editable fields, one for an opt-out capability', () => {
    expect(countItemSpecs([capability('a', 4), { ...capability('b', 4), access: 'none' }])).toBe(6)
  })

  it('accepts exactly the maximum and refuses one more', () => {
    expect(countItemSpecs(catalogueOf(ACCESS_MAX_ITEMS))).toBe(600)
    expect(() => assertCatalogueWithinLimits(catalogueOf(ACCESS_MAX_ITEMS))).not.toThrow()
    expect(countItemSpecs(catalogueOf(ACCESS_MAX_ITEMS + 1))).toBe(601)
    expect(() => assertCatalogueWithinLimits(catalogueOf(ACCESS_MAX_ITEMS + 1))).toThrow(
      expect.objectContaining({ reason: 'catalogueTooLarge' })
    )
  })

  it('refuses a capability with more editable fields than a list may name', () => {
    expect(() => assertCatalogueWithinLimits([capability('wide', 33)])).toThrow(
      expect.objectContaining({ reason: 'catalogueTooLarge' })
    )
  })
})

describe('response size boundaries (full UTF-8 JSON)', () => {
  const base = (): MemberAccess => ({
    member: { memberId: 'm1', userId: 'u1', name: null, email: '' },
    aclVersion: 1,
    scope: 'organization-membership',
    roles: { total: 0, items: [], truncated: false },
    unsafeLinkCount: 0,
    items: [],
    widening: {
      status: 'computed',
      scope: 'exactItems',
      excludedItems: 0,
      breadth: false,
      synergy: false,
      vetoed: false,
    },
    uncovered: { ruleCount: 0, roleSample: [] },
    qualifiers: [],
  })
  /** Pads the email with text of the given width until the JSON is exactly `target` bytes. */
  const sized = (target: number, glyph: string): MemberAccess => {
    const answer = base()
    const unit = Buffer.byteLength(glyph)
    const bytes = () => serializedJsonBytes(answer)
    answer.member.email = glyph.repeat(Math.floor((target - bytes()) / unit))
    while (bytes() < target) answer.member.email += 'a'
    return answer
  }

  it.each([
    ['ascii', 'a'],
    ['two-byte', 'é'],
    ['four-byte', '😀'],
  ])('is within the cap at cap-1 and cap, and refused at cap+1 (%s)', (_name, glyph) => {
    const cap = ACCESS_API_RESPONSE_BYTES
    expect(serializedJsonBytes(sized(cap - 1, glyph))).toBe(cap - 1)
    expect(() => assertResponseWithinCap(sized(cap - 1, glyph))).not.toThrow()
    expect(() => assertResponseWithinCap(sized(cap, glyph))).not.toThrow()
    expect(() => assertResponseWithinCap(sized(cap + 1, glyph))).toThrow(
      expect.objectContaining({ reason: 'responseTooLarge' })
    )
  })

  it('keeps room for the envelope the BFF adds', () => {
    expect(ACCESS_API_RESPONSE_BYTES).toBe(ACCESS_RESPONSE_BYTES - ROLE_ENVELOPE_RESERVE_BYTES)
    expect(ACCESS_API_RESPONSE_BYTES).toBe(523_264)
  })
})

describe('scenarios on a catalogue of one hundred capabilities', () => {
  const hundred = Array.from({ length: 100 }, (_, index) => capability(`c${index}`, 4))
  const id25 = (prefix: string, index: number): string =>
    `${prefix}${String(index).padStart(25 - prefix.length, '0')}`

  it('evaluates a real synthetic policy on 100 capabilities within the response and work caps', () => {
    const capabilities = Array.from({ length: 100 }, (_, index) => ({
      ...ORDER_UPDATE,
      id: `c${index}`,
      subject: index < 30 ? 'Role' : 'User',
      editableFields:
        index < 30
          ? ['id', 'name', 'description', 'organizationId']
          : ['id', 'name', 'email', 'phone'],
    }))
    const budget = new AccessOperationBudget()
    const answer = explainAccess(
      input(
        [
          {
            id: 'Manager',
            rules: [
              rule('rd', 'read', 'Role'),
              rule('up', 'update', 'Role', { fields: ['name'], conditions: { name: 'draft' } }),
            ],
          },
        ],
        { capabilities, budget }
      )
    )
    expect(memberAccessSchema.safeParse(answer).success).toBe(true)
    expect(
      answer.items.filter(
        (item) =>
          item.evaluation === 'configured' && item.state !== 'none' && !item.key.includes('.')
      )
    ).toHaveLength(30)
    expect(serializedJsonBytes(answer)).toBeLessThanOrEqual(ACCESS_API_RESPONSE_BYTES / 2)
    expect(budget.spent).toBeLessThan(budget.limit)
  })

  it('processes 600 specifications against 2000 validated rules within the real operation cap', () => {
    const capabilities = Array.from({ length: 120 }, (_, index) => ({
      ...ORDER_UPDATE,
      id: `c${index}`,
      editableFields: ['id', 'name', 'description', 'organizationId'],
    }))
    const budget = new AccessOperationBudget()
    const rules = Array.from({ length: 2000 }, (_, index) =>
      rule(`r${index}`, 'read', 'User', { fields: ['id'] })
    )
    const answer = explainAccess(input([{ id: 'R', rules }], { capabilities, budget }))
    expect(countItemSpecs(capabilities)).toBe(600)
    expect(memberAccessSchema.safeParse(answer).success).toBe(true)
    // One full-policy validation plus one rule-vs-item scan per specification.
    expect(budget.spentIn('relevance')).toBe((600 + 1) * 2000)
    expect(budget.spent).toBeLessThan(budget.limit)
  })

  it('S: a realistic person is answered within half of the cap', () => {
    // The member's roles configure about thirty of the hundred capabilities; the rest is "none".
    const answer = typical(100, 30)
    expect(memberAccessSchema.safeParse(answer).success).toBe(true)
    expect(serializedJsonBytes(answer)).toBeLessThanOrEqual(ACCESS_API_RESPONSE_BYTES / 2)
  })

  it('D: the densest answer is a valid response that is above the cap and is refused', () => {
    const answer = maxFilled(100, 100)
    expect(memberAccessSchema.safeParse(answer).success).toBe(true)
    expect(serializedJsonBytes(answer)).toBeGreaterThan(ACCESS_API_RESPONSE_BYTES)
    expect(() => assertResponseWithinCap(answer)).toThrow(
      expect.objectContaining({ reason: 'responseTooLarge' })
    )
    expect(hundred).toHaveLength(100)
  })

  /**
   * A person whose roles configure `configured` of the capabilities with one area, two roles and one
   * source each; field lines exist only where they differ (here a third of them).
   */
  function typical(total: number, configured: number): MemberAccess {
    const answer = maxFilled(total, 0)
    const refs = { roleIds: [id25('r', 1), id25('r', 2)], total: 2 }
    answer.items = answer.items
      .filter(
        (entry) =>
          !entry.key.includes('.') ||
          Number(entry.key.slice(1, entry.key.indexOf('.'))) < configured / 3
      )
      .map((entry) =>
        entry.evaluation === 'configured' &&
        Number(entry.key.replace(/^c(\d+).*/, '$1')) < configured
          ? {
              ...entry,
              state: 'configured' as const,
              areas: [
                {
                  kind: 'own' as const,
                  roles: refs,
                  fields: null,
                  prerequisite: 'met' as const,
                  masked: false,
                  absorbed: false,
                },
              ],
              sources: [
                {
                  kind: 'rule' as const,
                  via: 'direct' as const,
                  roleIds: refs.roleIds,
                  permissionId: id25('p', 1),
                  presetId: 'own',
                  effect: 'allow' as const,
                  status: 'contributes' as const,
                  area: 'own' as const,
                  prerequisite: 'met' as const,
                },
              ],
            }
          : entry
      )
    answer.widening.excludedItems = answer.items.length
    return answer
  }

  /** `dense` of `total` capabilities carry every array at its maximum; the others are minimal. */
  function maxFilled(total: number, dense: number): MemberAccess {
    const refs = (prefix: string) => ({
      roleIds: Array.from({ length: 5 }, (_, index) => id25(prefix, index)),
      total: 5,
    })
    const source = (index: number) => ({
      kind: 'rule' as const,
      via: 'direct' as const,
      roleIds: refs('r').roleIds,
      permissionId: id25('p', index),
      presetId: 'own',
      effect: 'allow' as const,
      status: 'contributes' as const,
      area: 'own' as const,
      prerequisite: 'unproven' as const,
    })
    const area = (kind: 'all' | 'assigned' | 'own' | 'custom') => ({
      kind,
      roles: refs('a'),
      fields: ['f0', 'f1', 'f2', 'f3'],
      prerequisite: 'unproven' as const,
      masked: false,
      absorbed: false,
    })
    const items = Array.from({ length: total * 5 }, (_, index) => {
      const key = `c${Math.floor(index / 5)}${index % 5 === 0 ? '' : `.f${(index % 5) - 1}`}`
      if (Math.floor(index / 5) >= dense)
        return {
          key,
          evaluation: 'configured' as const,
          baseline: false as const,
          state: 'none' as const,
          areas: [],
          limits: [],
          blockedBy: null,
          sources: [],
          sourcesTruncated: false,
        }
      return {
        key,
        evaluation: 'configured' as const,
        baseline: false as const,
        state: 'configured' as const,
        areas: (['all', 'assigned', 'own', 'custom'] as const).map(area),
        limits: [
          { kind: 'fields' as const, fields: ['f0', 'f1', 'f2', 'f3'] },
          { kind: 'condition' as const },
          { kind: 'denyCondition' as const },
          { kind: 'denyFields' as const, fields: ['f0', 'f1', 'f2', 'f3'] },
        ],
        blockedBy: null,
        sources: [source(index), source(index + 1), source(index + 2), source(index + 3)],
        sourcesTruncated: true,
      }
    })
    return {
      member: {
        memberId: id25('m', 0),
        userId: id25('u', 0),
        name: 'N'.repeat(100),
        email: `${'e'.repeat(60)}@example.test`,
      },
      aclVersion: 1,
      scope: 'organization-membership',
      roles: { total: 0, items: [], truncated: false },
      unsafeLinkCount: 0,
      items,
      widening: {
        status: 'computed',
        scope: 'exactItems',
        excludedItems: items.length,
        breadth: false,
        synergy: false,
        vetoed: false,
      },
      uncovered: { ruleCount: 0, roleSample: [] },
      qualifiers: [],
    }
  }
})
