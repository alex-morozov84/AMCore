import { Action, Subject } from '@amcore/shared'

import type { AccessCapability } from './access-capabilities'
import { isCovered } from './access-coverage'
import type { StoredPolicyRule } from './access-facts'

const ORDER: AccessCapability = {
  id: 'order.update',
  subject: 'Order',
  action: 'update',
  editableFields: ['status', 'note'],
  presets: ['own', 'all'],
  requiredReadFields: ['id', 'status'],
  teamAccess: false,
  preset: () => ({ action: 'update', subject: 'Order', conditions: null, fields: [] }),
}
const rule = (
  action: string,
  subject: string,
  over: Partial<StoredPolicyRule> = {}
): StoredPolicyRule => ({
  id: 'r',
  action,
  subject,
  conditions: null,
  fields: [],
  inverted: false,
  ...over,
})

describe('which stored rules the explanation covers', () => {
  const cases: [string, StoredPolicyRule, boolean][] = [
    ['any team access rule', rule(Action.Manage, Subject.TeamAccess), true],
    ['an organization rule for a built-in action', rule(Action.Update, Subject.Organization), true],
    ['an organization rule for another action', rule('export', Subject.Organization), false],
    [
      'an inverted rule on a team veto subject',
      rule('export', Subject.Role, { inverted: true }),
      true,
    ],
    ['an allow rule on a team veto subject', rule(Action.Read, Subject.User), false],
    [
      'an inverted rule on every subject',
      rule(Action.Manage, Subject.All, { inverted: true }),
      true,
    ],
    ['an allow rule on every subject', rule(Action.Manage, Subject.All), false],
    ['a rule a configured capability evaluates', rule('update', 'Order'), true],
    ['a manage rule on its subject', rule('manage', 'Order'), true],
    ['a deny on its subject and action', rule('update', 'Order', { inverted: true }), true],
    ['an action the capability does not use', rule('export', 'Order'), false],
    ['an inverted rule on an unused action', rule('export', 'Order', { inverted: true }), false],
    ['fields no matching capability knows', rule('update', 'Order', { fields: ['secret'] }), false],
    [
      'fields of which some are known',
      rule('update', 'Order', { fields: ['status', 'secret'] }),
      true,
    ],
    ['a wildcard field list', rule('update', 'Order', { fields: ['*'] }), true],
    ['an unknown domain', rule('read', 'Widget'), false],
    ['an inverted rule on an unknown domain', rule('read', 'Widget', { inverted: true }), false],
  ]
  it.each(cases)('%s', (_name, entry, covered) => {
    expect(isCovered(entry, [ORDER])).toBe(covered)
  })

  it('an opt-out capability explains nothing, deny rules included', () => {
    // The evaluator passes only the capabilities it evaluates; an opt-out one is never among them.
    expect(isCovered(rule('update', 'Order'), [])).toBe(false)
    expect(isCovered(rule('update', 'Order', { inverted: true }), [])).toBe(false)
  })

  it('a rule is covered when any matching capability knows one of its fields', () => {
    const second: AccessCapability = {
      ...ORDER,
      id: 'order.read',
      action: 'update',
      editableFields: ['secret'],
    }
    expect(isCovered(rule('update', 'Order', { fields: ['secret'] }), [ORDER, second])).toBe(true)
  })
})
