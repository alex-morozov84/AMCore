import {
  type AccessConfiguredItem,
  Action,
  type MemberAccess,
  memberAccessSchema,
} from '@amcore/shared'

import { AccessUnavailableError } from './access-budget'
import { explainAccess } from './access-evaluator'
import {
  input,
  ORDER_UPDATE,
  orderCapabilities,
  orderPresetRule,
  rule,
  USER_ID,
} from './access-fixtures'

type Role = { id: string; rules: ReturnType<typeof rule>[] }

const explain = (roles: Role[], capabilities = orderCapabilities()): MemberAccess => {
  const access = explainAccess(input(roles, { capabilities }))
  // Every answer the evaluator can produce is a valid answer.
  expect(memberAccessSchema.safeParse(access).success).toBe(true)
  return access
}
const configured = (access: MemberAccess, key: string): AccessConfiguredItem => {
  const found = access.items.find((entry) => entry.key === key)
  if (found?.evaluation !== 'configured') throw new Error(`${key} is not a configured item`)
  return found
}
const kinds = (item: AccessConfiguredItem) => item.areas.map((area) => area.kind)
const orders = (kind: 'read' | 'update', area: 'own' | 'assigned' | 'all', id: string) =>
  orderPresetRule(id, kind, area)
const deny = (
  id: string,
  action: string,
  options: { fields?: string[]; conditions?: Record<string, unknown> | null } = {}
) => rule(id, action, 'Role', { ...options, inverted: true })
const FIELDS = ['name', 'description']
const OWN = { organizationId: '${user.organizationId}' }

describe('configured items: what the role settings configure', () => {
  it('keeps distinct normalized date conditions separate for masks and read prerequisites', () => {
    const capability = {
      ...ORDER_UPDATE,
      id: 'archive.update',
      subject: 'Organization',
      editableFields: ['name'],
    }
    const access = explain(
      [
        {
          id: 'R',
          rules: [
            rule('rd', 'read', 'Organization', { conditions: { createdAt: { lt: 1000 } } }),
            rule('up', 'update', 'Organization', {
              fields: ['name'],
              conditions: { createdAt: { lt: 2000 } },
            }),
            rule('dn', 'update', 'Organization', {
              fields: ['name'],
              inverted: true,
              conditions: { createdAt: { lt: 1000 } },
            }),
          ],
        },
      ],
      [capability]
    )
    expect(configured(access, 'archive.update')).toMatchObject({
      state: 'configured',
      areas: [{ kind: 'custom', masked: false, prerequisite: 'unproven' }],
    })
  })
  it('own read + own update: one area, prerequisite proven by the identical condition', () => {
    const access = explain([
      { id: 'R', rules: [orders('read', 'own', 'rd'), orders('update', 'own', 'up')] },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'configured',
      evaluation: 'configured',
      areas: [{ kind: 'own', prerequisite: 'met', masked: false, absorbed: false }],
      limits: [],
    })
    expect(
      access.items.some((entry) => 'granted' in entry && entry.key.startsWith('fixture'))
    ).toBe(false)
  })

  it('read own + update assigned is never proven (prerequisite at another level)', () => {
    const access = explain([
      { id: 'R', rules: [orders('read', 'own', 'rd'), orders('update', 'assigned', 'up')] },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'configured',
      areas: [{ kind: 'assigned', prerequisite: 'unproven' }],
    })
  })

  it('update without any read is a missing prerequisite', () => {
    const access = explain([{ id: 'R', rules: [orders('update', 'all', 'up')] }])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'missingPrerequisite',
      areas: [{ kind: 'all', prerequisite: 'missing' }],
    })
  })

  it('an unconditional read deny on a required field blocks the whole item', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          orders('update', 'all', 'up'),
          deny('dn', 'read', { fields: ['name'] }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('blocked')
    expect(item.areas[0]).toMatchObject({ prerequisite: 'blocked' })
    expect(item.blockedBy).toEqual({ roleIds: ['R'], total: 1 })
  })

  it('a conditional read deny downgrades a proven prerequisite to unproven', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          orders('update', 'all', 'up'),
          deny('dn', 'read', { conditions: { name: 'closed' } }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item).toMatchObject({
      state: 'configured',
      areas: [{ kind: 'all', prerequisite: 'unproven' }],
    })
    expect(
      item.sources.find((source) => source.kind === 'rule' && source.permissionId === 'dn')
    ).toMatchObject({
      via: 'readPrerequisite',
      effect: 'deny',
      status: 'restricts',
    })
  })

  it('keeps field lines when otherwise identical areas are granted by different roles', () => {
    const access = explain([
      {
        id: 'Names',
        rules: [
          orders('read', 'all', 'rd'),
          rule('upName', 'update', 'Role', { fields: ['name'], conditions: OWN }),
        ],
      },
      {
        id: 'Descriptions',
        rules: [
          rule('upDescription', 'update', 'Role', { fields: ['description'], conditions: OWN }),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update.name').areas[0]?.roles.roleIds).toEqual([
      'Names',
    ])
    expect(configured(access, 'fixtureOrder.update.description').areas[0]?.roles.roleIds).toEqual([
      'Descriptions',
    ])
  })

  it('an allow and a deny with the identical condition mask the area', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'own', 'rd'),
          orders('update', 'own', 'up'),
          deny('dn', 'update', { conditions: OWN, fields: FIELDS }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('blocked')
    expect(item.areas).toMatchObject([{ kind: 'own', masked: true }])
    expect(item.sources[0]).toMatchObject({ effect: 'deny', status: 'vetoes' })
    expect(
      item.sources.some((entry) => entry.kind === 'rule' && entry.status === 'overridden')
    ).toBe(true)
  })

  it('a different conditional deny is a limit, not a block, and nothing is guessed', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'own', 'rd'),
          orders('update', 'own', 'up'),
          deny('dn', 'update', { conditions: { name: 'closed' }, fields: FIELDS }),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'configured',
      limits: [{ kind: 'denyCondition' }],
      sources: expect.arrayContaining([
        expect.objectContaining({ effect: 'deny', status: 'restricts' }),
      ]),
    })
  })

  it('an unconditional deny on one field blocks that field and limits the operation', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          orders('update', 'all', 'up'),
          deny('dn', 'update', { fields: ['description'] }),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'configured',
      limits: [{ kind: 'denyFields', fields: ['description'] }],
    })
    expect(configured(access, 'fixtureOrder.update.description').state).toBe('blocked')
    expect(configured(access, 'fixtureOrder.update.name').state).toBe('allowed')
  })

  it('own and assigned from two roles stay two independent areas', () => {
    const access = explain([
      { id: 'A', rules: [orders('read', 'all', 'rd'), orders('update', 'own', 'upo')] },
      { id: 'B', rules: [orders('read', 'all', 'rd'), orders('update', 'assigned', 'upa')] },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(kinds(item)).toEqual(['assigned', 'own'])
    expect(item.areas.map((area) => area.roles.roleIds)).toEqual([['B'], ['A']])
    expect(item.state).toBe('configured')
  })

  it('an unlimited area all absorbs the others, which add no limits', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          orders('update', 'all', 'upa'),
          orders('update', 'own', 'upo'),
          rule('cu', Action.Update, 'Role', {
            conditions: { name: 'open' },
            fields: ['description'],
          }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('allowed')
    expect(item.limits).toEqual([])
    expect(item.areas.filter((area) => area.absorbed).map((area) => area.kind)).toEqual([
      'own',
      'custom',
    ])
    expect(item.areas.find((area) => area.kind === 'all')?.absorbed).toBe(false)
  })

  it('a field-limited area all does not absorb and carries its limit', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          rule('upl', Action.Update, 'Role', { fields: ['name'] }),
          orders('update', 'own', 'upo'),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('configured')
    expect(item.limits).toEqual(expect.arrayContaining([{ kind: 'fields', fields: ['name'] }]))
    expect(item.areas.some((area) => area.absorbed)).toBe(false)
  })

  it('a deny identical to the own area keeps an area all from being called allowed', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'all', 'rd'),
          orders('update', 'all', 'upa'),
          orders('update', 'own', 'upo'),
          deny('dn', 'update', { conditions: OWN, fields: FIELDS }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('configured')
    expect(item.limits).toEqual([{ kind: 'denyCondition' }])
    expect(item.areas.find((area) => area.kind === 'own')?.masked).toBe(true)
  })

  it('an area all with an unproven prerequisite is configured, not allowed', () => {
    const access = explain([
      { id: 'R', rules: [orders('read', 'own', 'rd'), orders('update', 'all', 'up')] },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'configured',
      areas: [{ kind: 'all', prerequisite: 'unproven' }],
    })
  })

  it('reading needs no prerequisite', () => {
    const access = explain([{ id: 'R', rules: [orders('read', 'assigned', 'rd')] }])
    expect(configured(access, 'fixtureOrder.read')).toMatchObject({
      state: 'configured',
      areas: [{ kind: 'assigned', prerequisite: 'notRequired' }],
    })
  })

  it('without any rule the item is none and carries nothing', () => {
    const access = explain([{ id: 'R', rules: [] }])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'none',
      areas: [],
      limits: [],
      blockedBy: null,
      sources: [],
    })
  })

  it('a capability that opts out is never allowed or not allowed', () => {
    const access = explain(
      [{ id: 'R', rules: [orders('update', 'all', 'up')] }],
      orderCapabilities({ ...ORDER_UPDATE, id: 'fixtureOrder.archive', access: 'none' })
    )
    expect(access.items.find((entry) => entry.key === 'fixtureOrder.archive')).toEqual({
      key: 'fixtureOrder.archive',
      evaluation: 'notEvaluated',
      baseline: false,
      reason: 'optOut',
      sources: [],
      sourcesTruncated: false,
    })
  })

  it('an invalid stored rule still fails the whole request, with its reason', () => {
    expect(() =>
      explain([{ id: 'A', rules: [rule('bad', 'read', 'Organization', { fields: ['nope'] })] }])
    ).toThrow(expect.objectContaining({ reason: 'invalidPolicy' }))
    expect(AccessUnavailableError).toBeDefined()
  })
})

describe('the prerequisite of a custom area is aggregated from its rules (§14)', () => {
  const custom = (id: string, conditions: Record<string, unknown>, fields: string[]) =>
    rule(id, Action.Update, 'Role', { conditions, fields })
  const readWhere = (id: string, conditions: Record<string, unknown> | null) =>
    rule(id, Action.Read, 'Role', { conditions })
  const TEAM = { description: 't1' }

  it('mixed proven and unproven conditions are unproven, never met', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          custom('cx', OWN, ['name']),
          custom('cy', TEAM, ['description']),
          readWhere('rx', OWN),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.areas).toMatchObject([{ kind: 'custom', prerequisite: 'unproven' }])
    expect(item.state).toBe('configured')
    expect(item.limits).toEqual(expect.arrayContaining([{ kind: 'condition' }]))
  })

  it('every condition proven by an identical read is met', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          custom('cx', OWN, ['name']),
          custom('cy', TEAM, ['description']),
          readWhere('rx', OWN),
          readWhere('ry', TEAM),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update').areas).toMatchObject([
      { kind: 'custom', prerequisite: 'met' },
    ])
  })

  it('without any read the area is missing, and the state follows', () => {
    const access = explain([
      { id: 'R', rules: [custom('cx', OWN, ['name']), custom('cy', TEAM, ['description'])] },
    ])
    expect(configured(access, 'fixtureOrder.update')).toMatchObject({
      state: 'missingPrerequisite',
      areas: [{ kind: 'custom', prerequisite: 'missing' }],
    })
  })

  it('a masked rule does not take part in the aggregation', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          custom('cx', OWN, ['name']),
          custom('cy', TEAM, ['description']),
          readWhere('ry', TEAM),
          deny('dn', 'update', { conditions: OWN, fields: ['name'] }),
        ],
      },
    ])
    const area = configured(access, 'fixtureOrder.update').areas[0]
    expect(area).toMatchObject({ kind: 'custom', masked: false, prerequisite: 'met' })
  })

  it('field-limited rules of area all with mixed proof are unproven', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          rule('a1', Action.Update, 'Role', { fields: ['name'] }),
          rule('a2', Action.Update, 'Role', { fields: ['description'] }),
          readWhere('rd', OWN),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update').areas[0]).toMatchObject({
      kind: 'all',
      prerequisite: 'unproven',
    })
  })
})

describe('missingPrerequisite looks at unmasked areas only (§15)', () => {
  it('a masked area is ignored, the unmasked missing one decides', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('update', 'own', 'upo'),
          orders('update', 'assigned', 'upa'),
          deny('dn', 'update', { conditions: OWN, fields: FIELDS }),
        ],
      },
    ])
    const item = configured(access, 'fixtureOrder.update')
    expect(item.state).toBe('missingPrerequisite')
    expect(item.areas.find((area) => area.kind === 'own')?.masked).toBe(true)
  })

  it('an unmasked area that is merely unproven keeps the item configured', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('read', 'own', 'rd'),
          orders('update', 'own', 'upo'),
          orders('update', 'assigned', 'upa'),
          deny('dn', 'update', { conditions: OWN, fields: FIELDS }),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update').state).toBe('configured')
  })

  it('when every area is masked the item is blocked', () => {
    const access = explain([
      {
        id: 'R',
        rules: [
          orders('update', 'own', 'upo'),
          orders('update', 'assigned', 'upa'),
          deny('d1', 'update', { conditions: OWN, fields: FIELDS }),
          deny('d2', 'update', { conditions: { description: 'assigned' }, fields: FIELDS }),
        ],
      },
    ])
    expect(configured(access, 'fixtureOrder.update').state).toBe('blocked')
  })
})

describe('widening considers exact items only', () => {
  it('declares its scope and how many items it did not consider', () => {
    const access = explain([
      { id: 'R', rules: [orders('read', 'all', 'rd'), orders('update', 'own', 'up')] },
    ])
    expect(access.widening).toMatchObject({ scope: 'exactItems' })
    expect(access.widening.excludedItems).toBe(
      access.items.filter((entry) => entry.evaluation !== 'record').length
    )
    expect(access.widening.excludedItems).toBeGreaterThan(0)
  })
})

describe('every configured answer keeps its own state matrix', () => {
  it('holds over a deterministic sweep of rule combinations', () => {
    const pool = [
      orders('read', 'own', 'p1'),
      orders('read', 'assigned', 'p2'),
      orders('read', 'all', 'p3'),
      orders('update', 'own', 'p4'),
      orders('update', 'assigned', 'p5'),
      orders('update', 'all', 'p6'),
      rule('p7', Action.Update, 'Role', {
        conditions: { name: 'open' },
        fields: ['description'],
      }),
      rule('p8', Action.Update, 'Role', { fields: ['name'] }),
      deny('p9', 'update', { conditions: OWN, fields: FIELDS }),
      deny('p10', 'update', { fields: ['description'] }),
      deny('p11', 'read', { conditions: { name: 'closed' } }),
      deny('p12', 'read', { fields: ['name'] }),
      deny('p13', 'update'),
    ]
    let seen = 0
    for (let mask = 0; mask < 1 << pool.length; mask += 37) {
      const chosen = pool.filter((_, index) => (mask >> index) & 1)
      const half = Math.ceil(chosen.length / 2)
      const access = explain([
        { id: 'A', rules: chosen.slice(0, half) },
        { id: 'B', rules: chosen.slice(half) },
      ])
      expect(access.items.length).toBeGreaterThan(0)
      seen += 1
    }
    expect(seen).toBeGreaterThan(100)
    expect(USER_ID).toBeDefined()
  })
})
