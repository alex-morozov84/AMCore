import { Action, CAPABILITY_CATALOGUE, Subject } from '@amcore/shared'

import { ORG_DEFAULT_PERMISSIONS } from '../auth/casl/org-role-defaults'

import { CAPABILITY_ADAPTERS } from './capability-registry.service'
import { classifyStoredRule, isFullControlRule, presetKey } from './role-definition-classifier'

const rule = (over: Partial<Parameters<typeof classifyStoredRule>[0]> = {}) => ({
  id: 'perm-1',
  action: Action.Update as string,
  subject: Subject.Organization as string,
  conditions: { id: '${user.organizationId}' } as unknown,
  fields: ['name', 'slug'],
  inverted: false,
  ...over,
})

describe('classifyStoredRule', () => {
  it('recognizes every catalogue preset exactly as the registry builds it', () => {
    for (const descriptor of CAPABILITY_CATALOGUE) {
      for (const presetId of descriptor.presets) {
        const built = CAPABILITY_ADAPTERS[descriptor.id].preset(presetId)
        const kind = classifyStoredRule({
          id: 'p',
          action: built.action,
          subject: built.subject,
          conditions: built.conditions,
          fields: built.fields ?? [],
          inverted: built.inverted ?? false,
        })
        expect(kind).toEqual({ kind: 'preset', capabilityId: descriptor.id, presetId })
      }
    }
  })

  it('is independent of condition key order and field order', () => {
    expect(
      classifyStoredRule(
        rule({ fields: ['slug', 'name'], conditions: { id: '${user.organizationId}' } })
      )
    ).toEqual({ kind: 'preset', capabilityId: 'organization.update', presetId: 'own' })
    // Distinct key order must not matter for multi-key templates either.
    expect(classifyStoredRule(rule({ conditions: { b: 1, a: 2 }, fields: [] }))).toEqual({
      kind: 'advanced',
    })
  })

  it('keeps unresolved placeholders verbatim and never interpolates them', () => {
    expect(classifyStoredRule(rule({ conditions: { id: 'org-123' } }))).toEqual({
      kind: 'advanced',
    })
    expect(classifyStoredRule(rule({ conditions: { id: '${user.sub}' } }))).toEqual({
      kind: 'advanced',
    })
  })

  it('treats a restricted or widened field set, DENY and unknown shapes as advanced', () => {
    expect(classifyStoredRule(rule({ fields: ['name'] }))).toEqual({ kind: 'advanced' })
    expect(classifyStoredRule(rule({ fields: [] }))).toEqual({ kind: 'advanced' })
    expect(classifyStoredRule(rule({ fields: ['name', 'slug', 'slug'] }))).toEqual({
      kind: 'advanced',
    })
    expect(classifyStoredRule(rule({ inverted: true }))).toEqual({ kind: 'advanced' })
    expect(classifyStoredRule(rule({ conditions: {} }))).toEqual({ kind: 'advanced' })
    expect(classifyStoredRule(rule({ subject: 'Role' }))).toEqual({ kind: 'advanced' })
    // `null` conditions with the update field set is exactly the `all` preset, not advanced.
    expect(classifyStoredRule(rule({ conditions: null }))).toEqual({
      kind: 'preset',
      capabilityId: 'organization.update',
      presetId: 'all',
    })
  })

  it('does not mistake the builtin ADMIN field-limited read for the read preset', () => {
    const adminRead = ORG_DEFAULT_PERMISSIONS.find((p) => p.id === 'org-default-v2-read-org')!
    expect(
      classifyStoredRule({
        id: adminRead.id,
        action: adminRead.action,
        subject: adminRead.subject,
        conditions: adminRead.conditions,
        fields: adminRead.fields,
        inverted: adminRead.inverted,
      })
    ).toEqual({ kind: 'advanced' })
  })

  it('formats a stable preset key and detects configured full control', () => {
    expect(presetKey({ capabilityId: 'organization.read', presetId: 'own' })).toBe(
      'organization.read:own'
    )
    expect(isFullControlRule(rule({ action: Action.Manage, subject: Subject.TeamAccess }))).toBe(
      true
    )
    expect(
      isFullControlRule(
        rule({ action: Action.Manage, subject: Subject.TeamAccess, inverted: true })
      )
    ).toBe(false)
  })
})
