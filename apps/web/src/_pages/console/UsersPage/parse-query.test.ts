import { describe, expect, it } from 'vitest'

import { parsePage, parseSearch, parseSortBy, parseSortOrder } from './parse-query'

describe('parseSortBy', () => {
  it('accepts every field the Users UI actually exposes a sort header for', () => {
    expect(parseSortBy('name')).toBe('name')
    expect(parseSortBy('lastLoginAt')).toBe('lastLoginAt')
    expect(parseSortBy('createdAt')).toBe('createdAt')
    expect(parseSortBy('updatedAt')).toBe('updatedAt')
  })

  it('rejects "email" even though the backend allows sorting by it, since no header is active for it', () => {
    // A bookmarked/shared `?sortBy=email` must fall back to the default,
    // not silently sort the data while no column shows as active.
    expect(parseSortBy('email')).toBeUndefined()
  })

  it('rejects anything not in the allowlist, missing, or an array', () => {
    expect(parseSortBy('bogus')).toBeUndefined()
    expect(parseSortBy(undefined)).toBeUndefined()
    expect(parseSortBy(['name', 'email'])).toBeUndefined()
  })
})

describe('parseSearch', () => {
  it('trims and accepts an ordinary value', () => {
    expect(parseSearch('  alice  ')).toBe('alice')
  })

  it('treats empty, whitespace-only, oversized, or an array as no filter', () => {
    expect(parseSearch('')).toBeUndefined()
    expect(parseSearch('   ')).toBeUndefined()
    expect(parseSearch('a'.repeat(256))).toBeUndefined()
    expect(parseSearch(['a', 'b'])).toBeUndefined()
    expect(parseSearch(undefined)).toBeUndefined()
  })

  it('accepts exactly the 255-character limit', () => {
    const value = 'a'.repeat(255)
    expect(parseSearch(value)).toBe(value)
  })
})

describe('parsePage', () => {
  it('accepts a positive integer string', () => {
    expect(parsePage('3')).toBe(3)
  })

  it('falls back to the default page for missing, non-numeric, zero, negative, or an array', () => {
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage('abc')).toBe(1)
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-1')).toBe(1)
    expect(parsePage(['2', '3'])).toBe(1)
  })
})

describe('parseSortOrder', () => {
  it('accepts "asc"/"desc" and rejects anything else', () => {
    expect(parseSortOrder('asc')).toBe('asc')
    expect(parseSortOrder('desc')).toBe('desc')
    expect(parseSortOrder('bogus')).toBeUndefined()
    expect(parseSortOrder(undefined)).toBeUndefined()
  })
})
