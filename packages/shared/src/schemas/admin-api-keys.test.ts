import { describe, expect, it } from 'vitest'

import {
  adminApiKeyQuerySchema,
  adminApiKeyRevokeResponseSchema,
  adminApiKeyRevokeSchema,
} from './admin-api-keys'

const id = 'cm123456789012345678901234'
const uuid = '123e4567-e89b-42d3-a456-426614174000'

describe('platform API key contracts', () => {
  it('accepts Console CUID and UUID identities without widening key IDs', () => {
    for (const userId of [id, uuid]) {
      expect(adminApiKeyQuerySchema.parse({ userId, organizationId: userId }).userId).toBe(userId)
    }
    expect(adminApiKeyQuerySchema.safeParse({ id: uuid }).success).toBe(false)
    expect(adminApiKeyQuerySchema.safeParse({ userId: 'invalid' }).success).toBe(false)
  })

  it('bounds name search and list pagination', () => {
    expect(adminApiKeyQuerySchema.parse({ search: ' '.repeat(100) }).search).toBeUndefined()
    expect(adminApiKeyQuerySchema.safeParse({ search: 'a'.repeat(101) }).success).toBe(false)
    expect(adminApiKeyQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(adminApiKeyQuerySchema.safeParse({ sortBy: 'keyHash' }).success).toBe(false)
  })

  it('rejects ambiguous or unbounded bulk targets', () => {
    expect(adminApiKeyRevokeSchema.parse({ ids: [id] })).toEqual({ ids: [id] })
    for (const input of [
      { ids: [] },
      { ids: [id, id] },
      { ids: [uuid] },
      { ids: [id], all: true },
    ]) {
      expect(adminApiKeyRevokeSchema.safeParse(input).success).toBe(false)
    }
    expect(adminApiKeyRevokeSchema.safeParse({ ids: Array(101).fill(id) }).success).toBe(false)
  })

  it('cannot report more transitions than requested keys', () => {
    expect(
      adminApiKeyRevokeResponseSchema.safeParse({ requestedCount: 1, affectedCount: 2 }).success
    ).toBe(false)
    expect(
      adminApiKeyRevokeResponseSchema.parse({ requestedCount: 1, affectedCount: 0 }).affectedCount
    ).toBe(0)
  })
})
