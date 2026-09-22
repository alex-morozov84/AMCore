import { describe, expect, it } from 'vitest'

import { ariaSortValue, buildDiscoveryHref, toggleSortOrder } from './discovery-query'

describe('buildDiscoveryHref', () => {
  it('returns the bare base href when nothing but the default sort is set', () => {
    expect(buildDiscoveryHref('/en/admin/users', { sortBy: 'createdAt', page: 1 })).toBe(
      '/en/admin/users?sortBy=createdAt'
    )
  })

  it('omits search when empty, includes it when present', () => {
    expect(
      buildDiscoveryHref('/en/admin/users', { search: '', sortBy: 'createdAt', page: 1 })
    ).toBe('/en/admin/users?sortBy=createdAt')
    expect(
      buildDiscoveryHref('/en/admin/users', { search: 'alice', sortBy: 'createdAt', page: 1 })
    ).toBe('/en/admin/users?search=alice&sortBy=createdAt')
  })

  it('omits sortOrder when not explicitly given', () => {
    const href = buildDiscoveryHref('/en/admin/users', { sortBy: 'name', page: 1 })
    expect(href).not.toContain('sortOrder')
  })

  it('includes sortOrder when explicitly given', () => {
    expect(
      buildDiscoveryHref('/en/admin/users', { sortBy: 'name', sortOrder: 'desc', page: 1 })
    ).toBe('/en/admin/users?sortBy=name&sortOrder=desc')
  })

  it('omits page when it is 1, includes it otherwise', () => {
    expect(buildDiscoveryHref('/en/admin/users', { sortBy: 'createdAt', page: 1 })).not.toContain(
      'page'
    )
    expect(buildDiscoveryHref('/en/admin/users', { sortBy: 'createdAt', page: 3 })).toBe(
      '/en/admin/users?sortBy=createdAt&page=3'
    )
  })

  it('percent-encodes a search term with reserved URL characters', () => {
    const href = buildDiscoveryHref('/en/admin/users', {
      search: 'a&b=c',
      sortBy: 'createdAt',
      page: 1,
    })
    expect(href).toBe('/en/admin/users?search=a%26b%3Dc&sortBy=createdAt')
  })

  it('combines search, sortBy, sortOrder, and page in one canonical URL', () => {
    expect(
      buildDiscoveryHref('/en/admin/organizations', {
        search: 'acme',
        sortBy: 'name',
        sortOrder: 'asc',
        page: 2,
      })
    ).toBe('/en/admin/organizations?search=acme&sortBy=name&sortOrder=asc&page=2')
  })
})

describe('toggleSortOrder', () => {
  it("returns the column's own default when switching to a not-yet-active column", () => {
    expect(toggleSortOrder('name', { sortBy: 'createdAt' }, 'asc')).toBe('asc')
    expect(toggleSortOrder('lastLoginAt', { sortBy: 'name' }, 'desc')).toBe('desc')
  })

  it('toggles from the default when the column is already active with no explicit sortOrder', () => {
    expect(toggleSortOrder('name', { sortBy: 'name' }, 'asc')).toBe('desc')
  })

  it('toggles from the explicit current sortOrder when the column is already active', () => {
    expect(toggleSortOrder('name', { sortBy: 'name', sortOrder: 'desc' }, 'asc')).toBe('asc')
    expect(toggleSortOrder('name', { sortBy: 'name', sortOrder: 'asc' }, 'asc')).toBe('desc')
  })
})

describe('ariaSortValue', () => {
  it('is "none" for a column that is not the active sort', () => {
    expect(ariaSortValue('name', { sortBy: 'createdAt' }, 'asc')).toBe('none')
  })

  it("reflects the column's default direction when active with no explicit sortOrder", () => {
    expect(ariaSortValue('name', { sortBy: 'name' }, 'asc')).toBe('ascending')
    expect(ariaSortValue('createdAt', { sortBy: 'createdAt' }, 'desc')).toBe('descending')
  })

  it('reflects the explicit current sortOrder when active', () => {
    expect(ariaSortValue('name', { sortBy: 'name', sortOrder: 'desc' }, 'asc')).toBe('descending')
  })
})
