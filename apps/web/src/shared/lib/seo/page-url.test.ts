import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { pageUrl } from './page-url'

const origin = 'https://shop.example.com'

describe('pageUrl', () => {
  it('is the localized URL when the page has no query', () => {
    expect(pageUrl(origin, DEFAULT_LOCALE, '/catalog')).toBe(
      localizedFrontendUrl(origin, DEFAULT_LOCALE, '/catalog')
    )
    expect(pageUrl(origin, DEFAULT_LOCALE, '/catalog', {})).toBe(
      localizedFrontendUrl(origin, DEFAULT_LOCALE, '/catalog')
    )
    expect(pageUrl(origin, DEFAULT_LOCALE, '/catalog')).not.toContain('?')
  })

  it('appends the query with keys in alphabetical order, whatever the input order', () => {
    const a = pageUrl(origin, DEFAULT_LOCALE, '/catalog', { page: '2', brand: 'acme' })
    const b = pageUrl(origin, DEFAULT_LOCALE, '/catalog', { brand: 'acme', page: '2' })
    expect(a).toBe(b)
    expect(a).toMatch(/\/catalog\?brand=acme&page=2$/)
  })

  it('encodes keys and values', () => {
    expect(pageUrl(origin, DEFAULT_LOCALE, '/catalog', { q: 'a&b c' })).toMatch(
      /\/catalog\?q=a%26b%20c$/
    )
  })

  it('does not change its input', () => {
    const query = { page: '2', brand: 'acme' }
    pageUrl(origin, DEFAULT_LOCALE, '/catalog', query)
    expect(Object.keys(query)).toEqual(['page', 'brand'])
  })
})
