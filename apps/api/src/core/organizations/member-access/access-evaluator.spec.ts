import { Action, type MemberAccess, Subject } from '@amcore/shared'

import { ORG_READ_FIELDS } from '../../auth/casl/org-role-defaults'

import { explainAccess } from './access-evaluator'
import { input, ORG_ID, readAll, rule, USER_ID } from './access-fixtures'

const item = (access: MemberAccess, key: string) => access.items.find((entry) => entry.key === key)!
const granted = (access: MemberAccess) =>
  access.items.filter((entry) => !entry.baseline && entry.granted).map((entry) => entry.key)
const updateName = (id: string) =>
  rule(id, Action.Update, Subject.Organization, { fields: ['name'] })
const updateSlug = (id: string) =>
  rule(id, Action.Update, Subject.Organization, { fields: ['slug'] })
const team = (id: string) => rule(id, Action.Manage, Subject.TeamAccess)
const refs = (ids: string[], total = ids.length) => ({ roleIds: ids, total })

describe('member access explanation — truth table', () => {
  it('1. two roles each grant a field: breadth, single origin, no synergy', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [readAll('rgA'), updateName('nA')] },
        { id: 'B', rules: [readAll('rgB'), updateSlug('sB')] },
      ])
    )
    expect(granted(access)).toEqual([
      'organization.update',
      'organization.update.name',
      'organization.update.slug',
    ])
    expect(item(access, 'organization.update')).toMatchObject({
      origin: 'single',
      reachedBy: refs(['A', 'B']),
      actorHint: 'allowed',
    })
    expect(item(access, 'organization.update.name')).toMatchObject({ reachedBy: refs(['A']) })
    expect(item(access, 'organization.update.slug')).toMatchObject({ reachedBy: refs(['B']) })
    expect(item(access, 'organization.delete')).toMatchObject({ granted: false, reason: 'noGrant' })
    expect(item(access, 'teamAccess.manage')).toMatchObject({ granted: false, reason: 'noGrant' })
    expect(access.widening).toEqual({
      status: 'computed',
      breadth: true,
      synergy: false,
      vetoed: false,
    })
  })

  it('2. read fields split across roles are granted only together: combined origin', () => {
    const access = explainAccess(
      input([
        {
          id: 'A',
          rules: [
            rule('rA', Action.Read, Subject.Organization, { fields: ['id', 'name', 'slug'] }),
            updateName('nA'),
          ],
        },
        {
          id: 'B',
          rules: [
            rule('rB', Action.Read, Subject.Organization, {
              fields: ['aclVersion', 'createdAt', 'updatedAt'],
            }),
          ],
        },
      ])
    )
    expect(granted(access)).toEqual(['organization.update', 'organization.update.name'])
    expect(item(access, 'organization.update')).toMatchObject({
      origin: 'combined',
      reachedBy: refs([]),
      actorHint: 'allowed',
    })
    expect(access.widening).toEqual({
      status: 'computed',
      breadth: true,
      synergy: true,
      vetoed: false,
    })
  })

  it('3. an unconditional field DENY vetoes only that field', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [readAll('rgA'), updateName('nA')] },
        { id: 'B', rules: [readAll('rgB'), updateSlug('sB')] },
        {
          id: 'C',
          rules: [
            rule('dC', Action.Update, Subject.Organization, { fields: ['name'], inverted: true }),
          ],
        },
      ])
    )
    expect(granted(access)).toEqual(['organization.update', 'organization.update.slug'])
    const name = item(access, 'organization.update.name')
    expect(name).toMatchObject({
      granted: false,
      reason: 'vetoed',
      grantedBy: refs(['A']),
      vetoedBy: refs(['C']),
    })
    expect(name.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          via: 'direct',
          effect: 'deny',
          status: 'vetoes',
          permissionId: 'dC',
          roleIds: ['C'],
        }),
        expect.objectContaining({
          via: 'direct',
          effect: 'allow',
          status: 'overridden',
          permissionId: 'nA',
        }),
      ])
    )
    expect(access.widening).toEqual({
      status: 'computed',
      breadth: false,
      synergy: false,
      vetoed: true,
    })
  })

  it('4a. a DENY on User vetoes full control even though it never matches the organization row', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [team('tA')] },
        {
          id: 'B',
          rules: [
            rule('dB', Action.Read, Subject.User, { conditions: { id: USER_ID }, inverted: true }),
          ],
        },
      ])
    )
    const manage = item(access, 'teamAccess.manage')
    expect(manage).toMatchObject({
      granted: false,
      reason: 'vetoed',
      grantedBy: refs(['A']),
      vetoedBy: refs(['B']),
    })
    expect(manage.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          via: 'teamAccessVeto',
          effect: 'deny',
          status: 'vetoes',
          roleIds: ['B'],
        }),
        expect.objectContaining({
          via: 'teamAccessGate',
          effect: 'allow',
          status: 'overridden',
          roleIds: ['A'],
        }),
      ])
    )
    expect(item(access, 'organization.delete')).toMatchObject({ granted: false, reason: 'noGrant' })
  })

  it('4b. an explicit DENY of team access vetoes it', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [team('tA')] },
        { id: 'B', rules: [rule('dB', Action.Manage, Subject.TeamAccess, { inverted: true })] },
      ])
    )
    expect(item(access, 'teamAccess.manage')).toMatchObject({
      reason: 'vetoed',
      vetoedBy: refs(['B']),
    })
  })

  it('4c. delete depends on the current row: a matching condition grants, another id does not', () => {
    const grant = (conditions: Record<string, unknown>) =>
      explainAccess(
        input([
          {
            id: 'A',
            rules: [team('tA'), rule('dl', Action.Delete, Subject.Organization, { conditions })],
          },
        ])
      )
    const match = item(grant({ id: ORG_ID }), 'organization.delete')
    expect(match).toMatchObject({ granted: true, actorHint: 'recordRequired', origin: 'single' })
    const other = item(grant({ id: 'other-org' }), 'organization.delete')
    expect(other).toMatchObject({ granted: false, reason: 'noGrant', actorHint: 'recordRequired' })
  })

  it('4d. a delete grant without team access is a missing prerequisite', () => {
    const access = explainAccess(
      input([{ id: 'A', rules: [rule('dl', Action.Delete, Subject.Organization)] }])
    )
    expect(item(access, 'organization.delete')).toMatchObject({
      granted: false,
      reason: 'missingPrerequisite',
      actorHint: 'denied',
    })
  })

  it('5. no roles, or roles that grant nothing: only the membership baseline is granted', () => {
    for (const roles of [[], [{ id: 'E', rules: [] }]]) {
      const access = explainAccess(input(roles))
      expect(item(access, 'organization.read')).toMatchObject({
        baseline: true,
        granted: true,
        sources: [{ kind: 'membership' }],
        reachedBy: null,
        origin: null,
      })
      expect(granted(access)).toEqual([])
      expect(access.widening).toEqual({
        status: 'computed',
        breadth: false,
        synergy: false,
        vetoed: false,
      })
    }
  })

  it('6. one permission shared by two roles lists both roles', () => {
    const shared = rule('P', Action.Manage, Subject.Organization)
    const access = explainAccess(
      input([
        { id: 'A', rules: [shared] },
        { id: 'B', rules: [shared] },
      ])
    )
    expect(granted(access)).toEqual([
      'organization.update',
      'organization.update.name',
      'organization.update.slug',
    ])
    expect(item(access, 'organization.update')).toMatchObject({ reachedBy: refs(['A', 'B']) })
    expect(item(access, 'organization.update').sources[0]).toMatchObject({
      permissionId: 'P',
      roleIds: ['A', 'B'],
    })
    expect(item(access, 'teamAccess.manage')).toMatchObject({ granted: false })
    expect(access.widening).toMatchObject({ breadth: false, synergy: false, vetoed: false })
  })

  it('7. role and rule order never change the answer', () => {
    const roles = [
      { id: 'A', rules: [readAll('rgA'), updateName('nA')] },
      { id: 'B', rules: [readAll('rgB'), updateSlug('sB')] },
      {
        id: 'C',
        rules: [
          rule('dC', Action.Update, Subject.Organization, { fields: ['name'], inverted: true }),
        ],
      },
    ]
    const forward = JSON.stringify(explainAccess(input(roles)))
    const reversed = JSON.stringify(
      explainAccess(
        input([...roles].reverse().map((role) => ({ ...role, rules: [...role.rules].reverse() })))
      )
    )
    expect(reversed).toBe(forward)
  })

  it('8. a non-matching conditional DENY is not a veto and its hint downgrade is not synergy', () => {
    const roles = (condition: Record<string, unknown>) => [
      { id: 'A', rules: [readAll('rgA'), updateName('nA')] },
      {
        id: 'B',
        rules: [
          rule('dB', Action.Update, Subject.Organization, {
            fields: ['name'],
            conditions: condition,
            inverted: true,
          }),
        ],
      },
    ]
    const away = explainAccess(input(roles({ id: 'other-org' })))
    expect(granted(away)).toEqual(['organization.update', 'organization.update.name'])
    expect(item(away, 'organization.update.name')).toMatchObject({
      origin: 'single',
      reachedBy: refs(['A']),
    })
    expect(item(away, 'organization.update')).toMatchObject({ actorHint: 'recordRequired' })
    expect(JSON.stringify(item(away, 'organization.update.name').sources)).not.toContain('dB')
    expect(away.widening).toEqual({
      status: 'computed',
      breadth: false,
      synergy: false,
      vetoed: false,
    })
    const here = explainAccess(input(roles({ id: ORG_ID })))
    expect(item(here, 'organization.update.name')).toMatchObject({
      granted: false,
      reason: 'vetoed',
      vetoedBy: refs(['B']),
    })
  })

  it('9. denying a required read field vetoes update through the read prerequisite', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [readAll('rgA'), updateName('nA')] },
        {
          id: 'C',
          rules: [
            rule('dC', Action.Read, Subject.Organization, {
              fields: ['updatedAt'],
              inverted: true,
            }),
          ],
        },
      ])
    )
    for (const key of ['organization.update', 'organization.update.name'])
      expect(item(access, key)).toMatchObject({
        granted: false,
        reason: 'vetoed',
        grantedBy: refs(['A']),
        vetoedBy: refs(['C']),
      })
    expect(item(access, 'organization.update.name').sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          via: 'readPrerequisite',
          field: 'updatedAt',
          effect: 'deny',
          status: 'vetoes',
          permissionId: 'dC',
        }),
        expect.objectContaining({
          via: 'direct',
          effect: 'allow',
          status: 'overridden',
          permissionId: 'nA',
        }),
      ])
    )
    expect(item(access, 'organization.update.slug')).toMatchObject({
      reason: 'noGrant',
      vetoedBy: null,
    })
    expect(item(access, 'organization.update')).toMatchObject({ actorHint: 'denied' })
    expect(access.widening).toEqual({
      status: 'computed',
      breadth: false,
      synergy: false,
      vetoed: true,
    })
  })

  it('10a. a read DENY does not touch delete', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [team('tA'), rule('dl', Action.Delete, Subject.Organization)] },
        {
          id: 'B',
          rules: [
            rule('dB', Action.Read, Subject.Organization, {
              fields: ['updatedAt'],
              inverted: true,
            }),
          ],
        },
      ])
    )
    expect(item(access, 'teamAccess.manage')).toMatchObject({ granted: true })
    expect(item(access, 'organization.delete')).toMatchObject({
      granted: true,
      actorHint: 'allowed',
      origin: 'single',
      reachedBy: refs(['A']),
      vetoedBy: null,
    })
    expect(JSON.stringify(item(access, 'organization.delete').sources)).not.toContain('dB')
    expect(access.widening).toMatchObject({ breadth: false, synergy: false, vetoed: false })
  })

  it('10b. denying delete of one required field vetoes delete', () => {
    const access = explainAccess(
      input([
        { id: 'A', rules: [team('tA'), rule('dl', Action.Delete, Subject.Organization)] },
        {
          id: 'B',
          rules: [
            rule('dB', Action.Delete, Subject.Organization, {
              fields: ['updatedAt'],
              inverted: true,
            }),
          ],
        },
      ])
    )
    expect(item(access, 'teamAccess.manage')).toMatchObject({ granted: true })
    const remove = item(access, 'organization.delete')
    expect(remove).toMatchObject({
      granted: false,
      actorHint: 'denied',
      grantedBy: refs(['A']),
      vetoedBy: refs(['B']),
    })
    expect(remove.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          via: 'deletePrerequisite',
          field: 'updatedAt',
          effect: 'deny',
          status: 'vetoes',
        }),
      ])
    )
    expect(access.widening).toMatchObject({ breadth: false, synergy: false, vetoed: true })
  })

  it('11d. rules outside the catalogue are counted, not explained', () => {
    const access = explainAccess(
      input([
        { id: 'A', name: 'Alpha', rules: [rule('u1', Action.Read, Subject.User), readAll('rgA')] },
        { id: 'B', name: 'Beta', rules: [rule('u2', Action.Update, Subject.Role)] },
      ])
    )
    expect(access.uncovered).toEqual({
      ruleCount: 2,
      roleSample: [
        { id: 'A', name: 'Alpha' },
        { id: 'B', name: 'Beta' },
      ],
    })
  })

  it('11e. above the counterfactual caps the decision stays exact and attribution is unknown', () => {
    const many = Array.from({ length: 26 }, (_, index) => ({
      id: `R${String(index).padStart(2, '0')}`,
      rules: index === 0 ? [readAll('rg'), updateName('nm'), team('tm')] : [],
    }))
    const access = explainAccess(input(many))
    expect(access.widening).toEqual({
      status: 'unavailable',
      reason: 'roleLimit',
      breadth: null,
      synergy: null,
      vetoed: null,
    })
    expect(item(access, 'organization.update.name')).toMatchObject({
      granted: true,
      reason: 'granted',
      origin: null,
      reachedBy: null,
    })
    const slug = item(access, 'organization.update.slug')
    expect(slug).toMatchObject({ granted: false, reason: null, grantedBy: null, vetoedBy: null })
    expect(item(access, 'teamAccess.manage')).toMatchObject({ granted: true, actorHint: 'allowed' })
    expect(access.roles.total).toBe(26)
  })

  it('12. a platform super-admin target is only qualified, never simulated', () => {
    const access = explainAccess(
      input([], {
        member: {
          memberId: 'm',
          userId: USER_ID,
          name: null,
          email: 'a@example.test',
          systemRole: 'SUPER_ADMIN',
        },
      })
    )
    expect(access.qualifiers).toEqual(['platformSuperAdmin'])
    expect(granted(access)).toEqual([])
  })

  it('rejects a stored rule the authorization would reject', () => {
    expect(() =>
      explainAccess(
        input([
          { id: 'A', rules: [rule('bad', 'read', 'Organization', { fields: ['nope-field'] })] },
        ])
      )
    ).toThrow()
    void ORG_READ_FIELDS
  })
})
