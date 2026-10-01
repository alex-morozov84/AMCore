import { describe, expect, it } from 'vitest'

import { organizationAccessHrefs, organizationAccessPlacement } from './placement'

describe('ordinary organization placement', () => {
  it('preserves root defaults and explicit list escape', () => {
    const hrefs = organizationAccessHrefs(organizationAccessPlacement)
    expect(hrefs.menuHref).toBe('/organizations')
    expect(hrefs.listHref).toBe('/organizations?view=list')
    expect(hrefs.homeHref).toBe('/')
    expect(hrefs.contextHref('org_1')).toBe('/organizations/org_1')
  })
  it('derives every destination from a normalized custom path', () => {
    const hrefs = organizationAccessHrefs({
      organizationsPath: '/manage/organizations/',
      homeHref: '/crm/',
    })
    expect(hrefs.menuHref).toBe('/manage/organizations')
    expect(hrefs.listHref).toBe('/manage/organizations?view=list')
    expect(hrefs.pageHref(2)).toBe('/manage/organizations?view=list&page=2')
    expect(hrefs.contextHref('id/with space')).toBe('/manage/organizations/id%2Fwith%20space')
    expect(hrefs.homeHref).toBe('/crm')
  })
  it.each([
    '/',
    '',
    '//host/org',
    '/org//',
    '/a/../org',
    '/a/./org',
    '/org?q=1',
    '/org#id',
    '/%6Frg',
    '/org\\name',
    '/org name',
    'https://host/org',
  ])('rejects ambiguous organizations path %s', (organizationsPath) => {
    expect(() => organizationAccessHrefs({ organizationsPath, homeHref: '/' })).toThrow(
      /organizationsPath/
    )
  })
  it('validates home separately', () => {
    expect(() =>
      organizationAccessHrefs({ organizationsPath: '/org', homeHref: '//host' })
    ).toThrow(/homeHref/)
  })
})
