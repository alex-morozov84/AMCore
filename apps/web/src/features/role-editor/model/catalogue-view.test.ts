import type { CapabilityCatalogueResponse } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import {
  areaViews,
  isAreaOpen,
  isConfigured,
  isLarge,
  LARGE_CATALOGUE,
  matchesQuery,
} from './catalogue-view'

type Capability = CapabilityCatalogueResponse['capabilities'][number]
const capability = (id: string, subject: string): Capability =>
  ({
    id,
    subject,
    action: 'read',
    operation: id,
    method: 'GET',
    path: '/x',
    labelKey: id.replace('.', ''),
    credentials: ['bearer'],
    presets: ['own', 'all'],
    editableFields: [],
  }) as Capability
const none = () => ({ area: '' })

describe('catalogue view', () => {
  it('keeps the flat layout until the catalogue is large', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => capability(`c.${index}`, 'A'))
    expect(isLarge(many(LARGE_CATALOGUE))).toBe(false)
    expect(isLarge(many(LARGE_CATALOGUE + 1))).toBe(true)
  })

  it('a capability is configured when the draft grants any of its levels', () => {
    const entry = capability('order.read', 'Order')
    expect(isConfigured(entry, [])).toBe(false)
    expect(isConfigured(entry, ['order.read:own'])).toBe(true)
    expect(isConfigured(entry, ['order.write:all'])).toBe(false)
  })

  it('matches every word against label, description, id and area', () => {
    const entry = capability('order.read', 'Order')
    const texts = { label: 'View orders', description: 'See all of them', area: 'Sales' }
    expect(matchesQuery(entry, '', texts)).toBe(true)
    expect(matchesQuery(entry, 'view sales', texts)).toBe(true)
    expect(matchesQuery(entry, 'ORDER.read', texts)).toBe(true)
    expect(matchesQuery(entry, 'view invoices', texts)).toBe(false)
  })

  it('groups by area, filters, counts and leaves empty areas out', () => {
    const all = [capability('a.1', 'A'), capability('a.2', 'A'), capability('b.1', 'B')]
    const keys = ['a.2:all']
    expect(areaViews(all, keys, { query: '', onlyConfigured: false }, none)).toMatchObject([
      { area: 'A', total: 2, configured: 1 },
      { area: 'B', total: 1, configured: 0 },
    ])
    const only = areaViews(all, keys, { query: '', onlyConfigured: true }, none)
    expect(only.map((view) => [view.area, view.items.map((item) => item.id)])).toEqual([
      ['A', ['a.2']],
    ])
    expect(only[0]).toMatchObject({ total: 2, configured: 1 })
    expect(areaViews(all, keys, { query: 'zzz', onlyConfigured: false }, none)).toEqual([])
  })

  it('opens an area that has something configured, or every match of a search', () => {
    const view = { area: 'A', items: [], total: 3, configured: 1 }
    expect(isAreaOpen(view, {}, false)).toBe(true)
    expect(isAreaOpen({ ...view, configured: 0 }, {}, false)).toBe(false)
    expect(isAreaOpen({ ...view, configured: 0 }, {}, true)).toBe(true)
    expect(isAreaOpen(view, { A: false }, false)).toBe(false)
  })
})
