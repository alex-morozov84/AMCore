import { describe, expect, it } from 'vitest'

import { adminOrganizationListQuerySchema, adminUserListQuerySchema } from './admin'

/**
 * Contract tests for the admin discovery (search/sort) query schemas.
 * Whitespace-only `search` must normalize to "no filter" rather than 400 —
 * `.trim().min(1)` alone would reject it, which is exactly the bug this
 * schema's `.transform()` exists to avoid.
 */
describe('adminUserListQuerySchema', () => {
  it('defaults to page 1, limit 20, sortBy createdAt, no search, no sortOrder', () => {
    const result = adminUserListQuerySchema.parse({})
    expect(result).toEqual({
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      search: undefined,
      sortOrder: undefined,
    })
  })

  it('trims a search term', () => {
    expect(adminUserListQuerySchema.parse({ search: '  alice  ' }).search).toBe('alice')
  })

  it('normalizes a missing search term to undefined', () => {
    expect(adminUserListQuerySchema.parse({}).search).toBeUndefined()
  })

  it('normalizes a whitespace-only search term to undefined, not a validation error', () => {
    const result = adminUserListQuerySchema.safeParse({ search: '   ' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.search).toBeUndefined()
  })

  it('normalizes an empty-string search term to undefined', () => {
    const result = adminUserListQuerySchema.safeParse({ search: '' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.search).toBeUndefined()
  })

  it('rejects a search term over 255 characters', () => {
    expect(adminUserListQuerySchema.safeParse({ search: 'a'.repeat(256) }).success).toBe(false)
  })

  it('accepts a search term at exactly 255 characters', () => {
    expect(adminUserListQuerySchema.safeParse({ search: 'a'.repeat(255) }).success).toBe(true)
  })

  it.each(['name', 'email', 'lastLoginAt', 'createdAt', 'updatedAt'])(
    'accepts %s as sortBy',
    (sortBy) => {
      expect(adminUserListQuerySchema.safeParse({ sortBy }).success).toBe(true)
    }
  )

  it('rejects an unallowlisted sortBy', () => {
    expect(adminUserListQuerySchema.safeParse({ sortBy: 'systemRole' }).success).toBe(false)
    expect(adminUserListQuerySchema.safeParse({ sortBy: 'emailVerified' }).success).toBe(false)
  })

  it.each(['asc', 'desc'])('accepts %s as sortOrder', (sortOrder) => {
    expect(adminUserListQuerySchema.safeParse({ sortOrder }).success).toBe(true)
  })

  it('rejects an invalid sortOrder', () => {
    expect(adminUserListQuerySchema.safeParse({ sortOrder: 'ascending' }).success).toBe(false)
  })
})

describe('adminOrganizationListQuerySchema', () => {
  it('defaults to sortBy createdAt, no search, no sortOrder', () => {
    const result = adminOrganizationListQuerySchema.parse({})
    expect(result.sortBy).toBe('createdAt')
    expect(result.search).toBeUndefined()
    expect(result.sortOrder).toBeUndefined()
  })

  it('normalizes a whitespace-only search term to undefined, not a validation error', () => {
    const result = adminOrganizationListQuerySchema.safeParse({ search: '\t \n' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.search).toBeUndefined()
  })

  it.each(['name', 'slug', 'createdAt', 'updatedAt'])('accepts %s as sortBy', (sortBy) => {
    expect(adminOrganizationListQuerySchema.safeParse({ sortBy }).success).toBe(true)
  })

  it('rejects a sortBy that is only valid for Users', () => {
    expect(adminOrganizationListQuerySchema.safeParse({ sortBy: 'email' }).success).toBe(false)
    expect(adminOrganizationListQuerySchema.safeParse({ sortBy: 'lastLoginAt' }).success).toBe(
      false
    )
  })
})
