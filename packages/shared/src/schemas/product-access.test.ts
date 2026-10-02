import { describe, expect, it } from 'vitest'

import { updateOrganizationSchema } from './organization'
import { productAccessBootstrapSchema, productOrganizationContextSchema } from './product-access'

describe('product organization wire boundaries', () => {
  const binding = 'a'.repeat(64)

  it('accepts safe bootstrap/context but never credential or permission-tree extras', () => {
    const bootstrap = { binding, actor: { id: 'actor', email: 'actor@example.test' } }
    const context = {
      binding,
      data: {
        organization: { id: 'org-a', name: 'Company', slug: 'company' },
        canManageTeamAccess: true,
        actorAffordances: {
          'teamAccess.manage': 'allowed',
          'organization.read': 'allowed',
          'organization.update': 'recordRequired',
          'organization.delete': 'recordRequired',
        },
        recordAffordances: {
          'organization.read': { allowed: true, fields: {} },
          'organization.update': { allowed: false, fields: { name: false, slug: false } },
          'organization.delete': { allowed: false, fields: {} },
        },
      },
    }
    expect(productAccessBootstrapSchema.safeParse(bootstrap).success).toBe(true)
    expect(productOrganizationContextSchema.safeParse(context).success).toBe(true)
    expect(
      productAccessBootstrapSchema.safeParse({ ...bootstrap, accessToken: '<token>' }).success
    ).toBe(false)
    expect(
      productOrganizationContextSchema.safeParse({
        ...context,
        data: { ...context.data, permissions: [] },
      }).success
    ).toBe(false)
    expect(
      productOrganizationContextSchema.safeParse({
        ...context,
        data: { ...context.data, organization: { ...context.data.organization, aclVersion: 1 } },
      }).success
    ).toBe(false)
  })

  it.each(['', 'a'.repeat(63), 'A'.repeat(64), 'a'.repeat(65)])(
    'rejects malformed binding %p',
    (binding) => {
      expect(
        productAccessBootstrapSchema.safeParse({
          binding,
          actor: { id: 'actor', email: 'actor@example.test' },
        }).success
      ).toBe(false)
    }
  )

  it('PATCH accepts only mutable name/slug fields and rejects tenant overrides', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'Renamed', slug: 'renamed' }).success).toBe(
      true
    )
    for (const extra of ['id', 'organizationId', 'orgId', 'aclVersion']) {
      expect(
        updateOrganizationSchema.safeParse({ name: 'Renamed', [extra]: 'foreign' }).success
      ).toBe(false)
    }
  })
})
