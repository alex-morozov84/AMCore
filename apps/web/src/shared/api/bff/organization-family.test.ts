import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { isClosedOrganizationFamily } from './organization-family'

const base = 'http://api.test'
const families = [ORGANIZATION_CONTEXT_FAMILY, { apiRoots: ['/api/v1/context-rehearsal'] }]

describe('organization generic-family closure', () => {
  it.each([
    '/api/v1/organizations',
    '/api/v1/organizations/org-a/roles',
    '/api/v1/organizations/org-a/role-definitions',
    '/api/v1/organizations/org-a/role-definitions/role-1/deletion',
    '/api/v1/organizations/org-a/capabilities',
    '/api/v1/organizations/org-a/members/user-1/access',
    '/api/v1/ORGANIZATIONS/org-a/context/',
    '/api/v1//organizations//org-a',
    '/api/v1/%6Frganizations/org-a',
    '/api/v1/product-access/bootstrap',
    '/api/v1/context-rehearsal/workspaces/org-a',
  ])('closes exact family and aliases %s', (path) => {
    expect(isClosedOrganizationFamily(new URL(base + path), families, base)).toBe(true)
  })

  it.each([
    '/api/v1/admin/organizations',
    '/api/v1/organizations-other',
    '/api/v1/auth/invites/accept',
    '/api/v1/notifications/stream',
    '/api/v1/media/upload',
  ])('preserves unrelated path %s', (path) => {
    expect(isClosedOrganizationFamily(new URL(base + path), families, base)).toBe(false)
  })

  it.each([
    '/api/v1/organizations%2Forg-a',
    '/api/v1/%256Frganizations',
    '/api/v1/organizations/%ZZ',
  ])('refuses ambiguous or malformed path %s', (path) => {
    expect(isClosedOrganizationFamily(new URL(base + path), families, base)).toBe(true)
  })

  it('uses the configured base prefix and final URL dot normalization', () => {
    const prefixed = base + '/gateway'
    const upstream = new URL(prefixed + '/api/v1/other/../organizations/org-a')
    expect(isClosedOrganizationFamily(upstream, families, prefixed)).toBe(true)
    expect(
      isClosedOrganizationFamily(new URL(base + '/api/v1/organizations'), families, prefixed)
    ).toBe(false)
  })
})
