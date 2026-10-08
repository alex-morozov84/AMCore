import { describe, expect, it } from 'vitest'

import { CAPABILITY_CATALOGUE } from '../constants/capability-catalogue'

import { capabilityCatalogueResponseSchema } from './capability'
import {
  createRoleDefinitionSchema,
  deleteRoleDefinitionSchema,
  isReservedRoleName,
  roleDefinitionDetailSchema,
  roleDefinitionListQuerySchema,
  saveRoleDefinitionSchema,
} from './role-definition'
import {
  ROLE_DETAIL_API_RESPONSE_BYTES,
  ROLE_DETAIL_RESPONSE_BYTES,
  ROLE_ENVELOPE_RESERVE_BYTES,
  ROLE_LIST_API_RESPONSE_BYTES,
  ROLE_LIST_RESPONSE_BYTES,
} from './role-definition-budget'

const save = {
  expectedAclVersion: 3,
  name: ' Keep Raw ',
  description: ' spaced ',
  presets: [{ capabilityId: 'organization.read', presetId: 'own' }],
}

describe('role-definition schemas', () => {
  it('keeps the raw name and description on save (unchanged stored values are preserved verbatim)', () => {
    const parsed = saveRoleDefinitionSchema.parse(save)
    expect(parsed.name).toBe(' Keep Raw ')
    expect(parsed.description).toBe(' spaced ')
  })

  it('trims on create and accepts an absent or null description', () => {
    expect(createRoleDefinitionSchema.parse({ name: '  Sales  ' }).name).toBe('Sales')
    expect(
      createRoleDefinitionSchema.parse({ name: 'Sales', description: null }).description
    ).toBeNull()
    expect(createRoleDefinitionSchema.safeParse({ name: ' a ' }).success).toBe(false)
  })

  it('rejects unknown fields, duplicate presets, oversized selections and bad acknowledgments', () => {
    expect(saveRoleDefinitionSchema.safeParse({ ...save, extra: 1 }).success).toBe(false)
    expect(
      saveRoleDefinitionSchema.safeParse({ ...save, presets: [save.presets[0], save.presets[0]] })
        .success
    ).toBe(false)
    expect(
      saveRoleDefinitionSchema.safeParse({
        ...save,
        presets: Array.from({ length: 65 }, (_, i) => ({
          capabilityId: 'organization.read',
          presetId: i % 2 ? 'own' : 'all',
        })),
      }).success
    ).toBe(false)
    expect(
      saveRoleDefinitionSchema.safeParse({ ...save, acknowledgeFullControl: false }).success
    ).toBe(false)
    expect(
      saveRoleDefinitionSchema.safeParse({ ...save, acknowledgeFullControl: true }).success
    ).toBe(true)
    expect(
      deleteRoleDefinitionSchema.safeParse({
        expectedAclVersion: 1,
        expectedLiveInvitationCount: -1,
      }).success
    ).toBe(false)
  })

  it('bounds the list query offset and search length', () => {
    expect(roleDefinitionListQuerySchema.parse({}).limit).toBe(20)
    expect(roleDefinitionListQuerySchema.safeParse({ page: 1001, limit: 100 }).success).toBe(true)
    expect(roleDefinitionListQuerySchema.safeParse({ page: 1002, limit: 100 }).success).toBe(false)
    expect(roleDefinitionListQuerySchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false)
    expect(roleDefinitionListQuerySchema.safeParse({ unknown: 1 }).success).toBe(false)
  })

  it('matches reserved builtin names case-insensitively on trimmed input', () => {
    expect(isReservedRoleName(' admin ')).toBe(true)
    expect(isReservedRoleName('Viewer')).toBe(true)
    expect(isReservedRoleName('Viewers')).toBe(false)
  })

  it('reserves envelope bytes so an API success at its cap fits the BFF cap', () => {
    expect(ROLE_LIST_API_RESPONSE_BYTES + ROLE_ENVELOPE_RESERVE_BYTES).toBe(
      ROLE_LIST_RESPONSE_BYTES
    )
    expect(ROLE_DETAIL_API_RESPONSE_BYTES + ROLE_ENVELOPE_RESERVE_BYTES).toBe(
      ROLE_DETAIL_RESPONSE_BYTES
    )
  })

  it('requires a detail to be bounded: advanced rules and managed presets may be null when oversized', () => {
    const base = {
      role: { id: 'r1', name: 'Big', description: null, isSystem: false, organizationId: 'o1' },
      aclVersion: 1,
      editMode: 'oversized',
      selfHeld: false,
      grantsFullControl: false,
      ruleCount: 999,
      managedPresets: null,
      advancedRules: null,
      holders: { total: 0, sample: [], truncated: false },
      impact: { liveInvitationCount: 0 },
    }
    expect(roleDefinitionDetailSchema.safeParse(base).success).toBe(true)
    expect(roleDefinitionDetailSchema.safeParse({ ...base, extra: true }).success).toBe(false)
  })
})

describe('capability descriptor risk', () => {
  it('declares `fullControl` only on the unrestricted team-access capability and the response schema accepts it', () => {
    const risky = CAPABILITY_CATALOGUE.filter((entry) => 'risk' in entry).map((entry) => entry.id)
    expect(risky).toEqual(['teamAccess.manage'])
    expect(
      capabilityCatalogueResponseSchema.safeParse({ capabilities: CAPABILITY_CATALOGUE }).success
    ).toBe(true)
  })
})
