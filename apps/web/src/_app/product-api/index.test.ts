import { describe, expect, it } from 'vitest'

import { isClosedOrganizationFamily } from '@/shared/api/bff/organization-family'

import { productOrganizationFamilies } from './index'

describe('retained application organization families', () => {
  it.each([
    '/api/v1/organizations',
    '/api/v1/organizations/org/members',
    '/api/v1/organizations/org/roles',
    '/api/v1/organizations/org/invites',
    '/api/v1/product-access/probe',
  ])('closes actual registered family %s', (path) => {
    expect(productOrganizationFamilies.length).toBeGreaterThan(0)
    expect(
      isClosedOrganizationFamily(
        new URL(`http://api.test${path}`),
        productOrganizationFamilies,
        'http://api.test'
      )
    ).toBe(true)
  })
  it('keeps unrelated route outside family closure', () => {
    expect(
      isClosedOrganizationFamily(
        new URL('http://api.test/api/v1/auth/me'),
        productOrganizationFamilies,
        'http://api.test'
      )
    ).toBe(false)
  })
})
