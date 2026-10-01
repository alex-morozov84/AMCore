import type { RawRuleOf } from '@casl/ability'

import { Action, Subject } from '@amcore/shared'

import type { AppAbility, TeamAccessDecision } from '../auth/casl/ability.factory'
import { createPrismaAbility } from '../auth/casl/prisma-ability'

import { CapabilityRegistry } from './capability-registry.service'

const registry = new CapabilityRegistry()
const team: TeamAccessDecision = {
  actorId: 'user',
  type: 'jwt',
  organizationId: 'org',
  aclVersion: 1,
  ownerTrusted: true,
  credentialTrusted: true,
}
const ability = (rules: unknown[]) =>
  createPrismaAbility<AppAbility>(rules as RawRuleOf<AppAbility>[])

describe('capability actor projection', () => {
  it('never calls a conditional allow blanket access and preserves conditional DENY uncertainty', () => {
    const conditional = ability([
      { action: Action.Read, subject: Subject.Organization },
      { action: Action.Delete, subject: Subject.Organization, conditions: { id: 'assigned' } },
    ])
    expect(registry.actor(conditional, team)['organization.delete']).toBe('recordRequired')
    const veto = ability([
      { action: Action.Read, subject: Subject.Organization },
      { action: Action.Delete, subject: Subject.Organization },
      {
        action: Action.Delete,
        subject: Subject.Organization,
        conditions: { id: 'locked' },
        inverted: true,
      },
    ])
    expect(registry.actor(veto, team)['organization.delete']).toBe('recordRequired')
    expect(registry.actor(veto, { ...team, ownerTrusted: false })['organization.delete']).toBe(
      'denied'
    )
  })

  it('global DENY of one required scalar vetoes delete, while field-limited update remains possible', () => {
    const rules = ability([
      { action: Action.Read, subject: Subject.Organization },
      { action: Action.Delete, subject: Subject.Organization },
      { action: Action.Delete, subject: Subject.Organization, fields: ['name'], inverted: true },
      { action: Action.Update, subject: Subject.Organization, fields: ['slug'] },
    ])
    expect(registry.actor(rules, team)['organization.delete']).toBe('denied')
    expect(registry.actor(rules, team)['organization.update']).toBe('allowed')
  })

  it('treats empty conditions as unconditional for allows and required-field DENYs', () => {
    const allow = ability([
      { action: Action.Read, subject: Subject.Organization, conditions: {} },
      { action: Action.Delete, subject: Subject.Organization, conditions: {} },
      { action: Action.Update, subject: Subject.Organization, fields: ['slug'], conditions: {} },
    ])
    expect(registry.actor(allow, team)['organization.delete']).toBe('allowed')
    expect(registry.actor(allow, team)['organization.update']).toBe('allowed')
    const denied = ability([
      ...allow.rules,
      {
        action: Action.Delete,
        subject: Subject.Organization,
        fields: ['name'],
        conditions: {},
        inverted: true,
      },
    ])
    expect(registry.actor(denied, team)['organization.delete']).toBe('denied')
  })
})
