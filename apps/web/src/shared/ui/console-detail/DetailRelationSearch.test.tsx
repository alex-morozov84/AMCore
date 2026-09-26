import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({
    href,
    children,
    onNavigate,
  }: {
    href: string
    children: ReactNode
    onNavigate?: () => void
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (!event.metaKey && !event.ctrlKey) onNavigate?.()
      }}
    >
      {children}
    </a>
  ),
}))

import { DetailRelationNavigationLink, DetailRelationSearch } from './DetailRelationSearch'

function relation(search?: string, row = 'Old row') {
  return (
    <DetailRelationSearch
      base="/en/admin/users/user1"
      page={1}
      search={search}
      inputId="organizations-search"
      label="Search organizations"
      placeholder="Search by name"
      clearLabel="Clear search"
    >
      <p>{row}</p>
      <DetailRelationNavigationLink href="/en/admin/users/user1?page=2">
        Next page
      </DetailRelationNavigationLink>
    </DetailRelationSearch>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  replace.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('detail relation refresh', () => {
  it('keeps the search field focused while stale rows become a skeleton', () => {
    const view = render(relation())
    const field = screen.getByLabelText('Search organizations')
    field.focus()
    fireEvent.change(field, { target: { value: 'Harbor' } })
    act(() => vi.advanceTimersByTime(300))
    expect(replace).toHaveBeenCalledWith('/en/admin/users/user1?search=Harbor', {
      scroll: false,
    })
    expect(screen.queryByText('Old row')).toBeNull()
    expect(screen.getByLabelText('Search organizations')).toHaveFocus()
    expect(document.querySelector('[aria-busy="true"]')).toBeVisible()

    view.rerender(relation('Harbor', 'Harbor Research'))
    expect(screen.getByText('Harbor Research')).toBeVisible()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('shows the skeleton for same-tab paging but leaves modified clicks alone', () => {
    render(relation())
    fireEvent.click(screen.getByRole('link', { name: 'Next page' }), { metaKey: true })
    expect(screen.getByText('Old row')).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: 'Next page' }))
    expect(document.querySelector('[aria-busy="true"]')).toBeVisible()
    expect(screen.queryByText('Old row')).toBeNull()
  })
})
