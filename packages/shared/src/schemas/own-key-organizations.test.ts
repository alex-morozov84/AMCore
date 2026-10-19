import { describe, expect, it } from 'vitest'

import { ownKeyQuerySchema } from './own-api-keys'
import { ownKeyOrganizationsQuerySchema, ownKeyOrganizationsSchema } from './own-key-organizations'
const id = 'cmp00000000000000000000000'
const option = { id, name: 'Acme', slug: 'acme' }
describe('owner metadata and list bounds', () => {
  it('rejects ambiguous filters and unsafe offsets, preserves literal normalized search', () => {
    expect(
      ownKeyQuerySchema.safeParse({ organizationId: id, organizationAvailability: 'unavailable' })
        .success
    ).toBe(false)
    expect(ownKeyQuerySchema.safeParse({ page: Number.MAX_SAFE_INTEGER, limit: 100 }).success).toBe(
      false
    )
    expect(ownKeyQuerySchema.parse({ search: '  Отчёт_%\\  ' }).search).toBe('Отчёт_%\\')
    expect(
      ownKeyOrganizationsQuerySchema.safeParse({ purpose: 'creation', limit: 21 }).success
    ).toBe(false)
    expect(
      ownKeyOrganizationsQuerySchema.safeParse({ purpose: 'creation', unexpected: true }).success
    ).toBe(false)
  })
  it('keeps purpose variants strict and rejects duplicates and oversized safe metadata', () => {
    const base = {
      purpose: 'inventory',
      data: [option],
      selected: option,
      total: 1,
      page: 1,
      limit: 20,
      hasUnavailable: false,
    }
    expect(ownKeyOrganizationsSchema.safeParse(base).success).toBe(true)
    expect(
      ownKeyOrganizationsSchema.safeParse({
        ...base,
        data: [{ ...option, canManageTeamAccess: true }],
      }).success
    ).toBe(false)
    expect(ownKeyOrganizationsSchema.safeParse({ ...base, purpose: 'creation' }).success).toBe(
      false
    )
    expect(ownKeyOrganizationsSchema.safeParse({ ...base, data: [option, option] }).success).toBe(
      false
    )
    expect(
      ownKeyOrganizationsSchema.safeParse({
        ...base,
        data: [{ ...option, name: 'x'.repeat(33000) }],
      }).success
    ).toBe(false)
  })
})
