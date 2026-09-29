import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { OrganizationContextData } from '@/entities/organization-context'

import { useAccessNavigation } from './use-access-navigation'

vi.mock('client-only', () => ({}))

const entry = {
  id: 'company',
  name: 'Company',
  slug: 'company',
  aclVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
function setup(data: OrganizationContextData, page = 1, explicitList = false) {
  const props = {
    data,
    state: { target: 'list', status: 'ready' as const },
    input: { kind: 'list' as const, page, locale: 'en' },
    explicitList,
    refresh: vi.fn(),
    onReplace: vi.fn(),
    contextHref: (id: string) => `/workspace/${id}`,
    pageHref: (value: number) => `/workspace?page=${value}`,
  }
  const hook = renderHook((value) => useAccessNavigation(value), { initialProps: props })
  return { ...hook, props }
}
describe('page-owned bounded navigation', () => {
  it('opens a single organization once, preserving explicit list access', () => {
    const data = { binding: 'session', data: { data: [entry], total: 1, page: 1, limit: 20 } }
    const one = setup(data)
    one.rerender({ ...one.props })
    expect(one.props.onReplace).toHaveBeenCalledExactlyOnceWith('/workspace/company')
    const explicit = setup(data, 1, true)
    expect(explicit.props.onReplace).not.toHaveBeenCalled()
  })
  it('recovers inconsistent authority once and permits an explicit manual retry', () => {
    const one = setup({ binding: 'session', data: { data: [], total: 3, page: 1, limit: 20 } })
    one.rerender({ ...one.props })
    expect(one.props.refresh).toHaveBeenCalledTimes(1)
    one.result.current.refresh()
    expect(one.props.refresh).toHaveBeenCalledTimes(2)
  })
  it('returns an out-of-range list to page one instead of starting a retry loop', () => {
    const one = setup({ binding: 'session', data: { data: [], total: 3, page: 5, limit: 20 } }, 5)
    one.rerender({ ...one.props })
    expect(one.props.onReplace).toHaveBeenCalledExactlyOnceWith('/workspace?page=1')
    expect(one.props.refresh).not.toHaveBeenCalled()
  })
})
