import { describe, expect, it } from 'vitest'

import { apiKeyListItemSchema, createApiKeySchema } from './api-keys'
import { memberKeyListSchema } from './member-api-keys'
import { ownKeyCreateSchema, ownKeyRevokedSchema, ownKeySessionSchema } from './own-api-keys'

describe('dedicated own-key contracts', () => {
  it('bounds only the browser create contract and rejects unknown input', () => {
    const input = {
      name: 'Export',
      organizationId: 'cmp00000000000000000000000',
      scopes: Array.from({ length: 65 }, () => 'read:User'),
    }
    expect(createApiKeySchema.safeParse(input).success).toBe(true)
    expect(ownKeyCreateSchema.safeParse(input).success).toBe(false)
    expect(
      ownKeyCreateSchema.safeParse({ ...input, scopes: ['read:User'], userId: 'other' }).success
    ).toBe(false)
  })
  it('requires nullable organization name only in the owner projection', () => {
    expect(apiKeyListItemSchema.shape.organizationName.safeParse(null).success).toBe(true)
    expect(apiKeyListItemSchema.shape.organizationName.safeParse(undefined).success).toBe(false)
    expect(memberKeyListSchema.shape.data.element.shape).not.toHaveProperty('organizationName')
  })
  it('uses strict, exact session and revocation acknowledgments', () => {
    expect(ownKeySessionSchema.safeParse({ verified: true, key: '<fake>' }).success).toBe(false)
    expect(ownKeyRevokedSchema.safeParse({ revoked: false }).success).toBe(false)
  })
})
