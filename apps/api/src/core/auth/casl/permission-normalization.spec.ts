import { subject } from '@casl/ability'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { AbilityFactory } from './ability.factory'
import {
  type AbilityPermission,
  narrowPermissions,
  normalizeOwnerPermissions,
} from './permission-normalization'

const actor: RequestPrincipal = {
  type: 'jwt',
  sub: 'user',
  organizationId: 'org',
  aclVersion: 1,
  systemRole: SystemRole.User,
}
const rule = (overrides: Partial<AbilityPermission> = {}): AbilityPermission => ({
  id: 'allow',
  action: Action.Manage,
  subject: Subject.Organization,
  conditions: null,
  fields: [],
  inverted: false,
  ...overrides,
})

function factory(rules: AbilityPermission[]) {
  return new AbilityFactory(
    { getPermissions: async () => rules } as never,
    { getCurrent: async () => 1 } as never
  )
}

describe('total owner normalization', () => {
  it('deny wins regardless of input rule/scope order and duplicates', async () => {
    const allow = rule()
    const deny = rule({ id: 'deny', action: Action.Update, inverted: true, fields: ['name'] })
    for (const rules of [
      [allow, deny],
      [deny, allow, allow],
    ]) {
      for (const scopes of [
        ['manage:Organization', 'update:Organization'],
        ['update:Organization', 'manage:Organization', 'update:Organization'],
      ]) {
        const ability = await factory(rules).createForUser({ ...actor, type: 'api_key', scopes })
        const org = subject('Organization', { id: 'org', name: 'Name' } as never)
        expect(ability.can(Action.Update, org, 'name')).toBe(false)
        expect(ability.can(Action.Update, org, 'slug')).toBe(true)
      }
    }
    expect(
      narrowPermissions(normalizeOwnerPermissions([allow, deny], actor), [
        'read:Organization',
        'read:Organization',
      ])
    ).toHaveLength(1)
  })

  it.each([
    rule({ subject: Subject.All }),
    rule({ subject: 'typo' }),
    rule({ id: '' }),
    rule({ conditions: [] }),
    rule({ conditions: { id: undefined } }),
    rule({ subject: Subject.TeamAccess, fields: ['name'] }),
    rule({ conditions: { id: { unsupportedOperator: 'x' } } }),
    rule({ conditions: { id: '${user.misspelled}' } }),
  ])('fails the entire payload before unrelated scopes can hide corruption', async (invalid) => {
    await expect(
      factory([rule(), invalid]).createForUser({ ...actor, type: 'api_key', scopes: ['read:User'] })
    ).rejects.toThrow()
  })

  it('rejects conflicting source identities, preserving distinct IDs', () => {
    expect(() => normalizeOwnerPermissions([rule(), rule({ fields: ['name'] })], actor)).toThrow(
      'Conflicting'
    )
    expect(normalizeOwnerPermissions([rule(), rule({ id: 'other' })], actor)).toHaveLength(2)
  })

  it('computes owner trust before scope narrowing and requires exact team scope', async () => {
    const team = rule({ subject: Subject.TeamAccess })
    expect((await factory([team]).createAuthorizationContext(actor)).teamAccess.ownerTrusted).toBe(
      true
    )
    for (const scope of ['manage:Organization', 'read:TeamAccess']) {
      const context = await factory([team]).createAuthorizationContext({
        ...actor,
        type: 'api_key',
        scopes: [scope],
      })
      expect(context.teamAccess.credentialTrusted).toBe(false)
    }
    const key = { ...actor, type: 'api_key' as const, scopes: ['manage:TeamAccess'] }
    expect(
      (await factory([team]).createAuthorizationContext(key)).teamAccess.credentialTrusted
    ).toBe(true)
    const roleDeny = rule({
      id: 'role-deny',
      subject: Subject.Role,
      action: Action.Read,
      inverted: true,
      fields: ['name'],
      conditions: { id: 'impossible' },
    })
    expect(
      (await factory([team, roleDeny]).createAuthorizationContext(key)).teamAccess.ownerTrusted
    ).toBe(false)
    expect(
      (
        await factory([team, rule({ id: 'org-deny', inverted: true })]).createAuthorizationContext(
          key
        )
      ).teamAccess.ownerTrusted
    ).toBe(true)
    expect(
      (await factory([rule()]).createAuthorizationContext(actor)).teamAccess.ownerTrusted
    ).toBe(false)
  })
  it('JSON epoch DateTime conditions parse and distinguish actual Date facts', async () => {
    const epoch = Date.parse('2000-01-01T00:00:00.000Z')
    const deny = rule({
      id: 'date-deny',
      action: Action.Update,
      inverted: true,
      conditions: JSON.parse(JSON.stringify({ updatedAt: { gt: epoch } })),
    })
    const ability = await factory([rule(), deny]).createForUser(actor)
    const before = subject('Organization', { id: 'org', updatedAt: new Date(epoch) } as never)
    const after = subject('Organization', { id: 'org', updatedAt: new Date(epoch + 1) } as never)
    expect(ability.can(Action.Update, before, 'name')).toBe(true)
    expect(ability.can(Action.Update, after, 'name')).toBe(false)
  })
})
