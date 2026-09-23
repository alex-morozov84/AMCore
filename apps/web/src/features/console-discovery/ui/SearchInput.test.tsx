import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replaceMock = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: replaceMock }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({
    children,
    href,
    onNavigate,
    ...props
  }: {
    children: ReactNode
    onNavigate?: () => void
    href: string
  }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault()
        const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        if (!modified) onNavigate?.()
      }}
    >
      {children}
    </a>
  ),
}))

import { DiscoveryNavigationLink } from './DiscoveryNavigationLink'
import { DiscoverySearchBoundary } from './DiscoverySearchBoundary'
import { SearchInput } from './SearchInput'

function renderDiscovery(
  overrides: Partial<React.ComponentProps<typeof DiscoverySearchBoundary>> = {}
) {
  return render(
    <DiscoverySearchBoundary
      baseHref="/en/admin/users"
      page={1}
      sortBy="createdAt"
      effectiveSortOrder="desc"
      {...overrides}
    >
      <SearchInput
        label="Search users"
        placeholder="Search by name or email"
        clearLabel="Clear search"
        inputId="users-search"
      />
      <DiscoveryNavigationLink href="/en/admin/users?sortBy=name">
        Sort by name
      </DiscoveryNavigationLink>
    </DiscoverySearchBoundary>
  )
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  replaceMock.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('SearchInput discovery adapter', () => {
  it('does not navigate on mount and commits a trimmed draft after 300 ms', () => {
    renderDiscovery()
    advance(1000)
    expect(replaceMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: ' alice ' } })
    advance(299)
    expect(replaceMock).not.toHaveBeenCalled()
    advance(1)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=alice&sortBy=createdAt', {
      scroll: false,
    })

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '   ' } })
    advance(300)
    expect(replaceMock).toHaveBeenLastCalledWith('/en/admin/users?sortBy=createdAt', {
      scroll: false,
    })
  })

  it('submits immediately once and keeps the no-JS GET contract', () => {
    renderDiscovery({ sortBy: 'name', sortOrder: 'desc', effectiveSortOrder: 'desc' })
    const input = screen.getByLabelText('Search users')
    const form = input.closest('form')!
    expect(form).toHaveAttribute('method', 'GET')
    expect(form).toHaveAttribute('action', '/en/admin/users')
    expect(input).toHaveAttribute('name', 'search')
    expect(input).toHaveAttribute('maxlength', '255')
    expect(form.querySelector('[name="sortBy"]')).toHaveValue('name')
    expect(form.querySelector('[name="sortOrder"]')).toHaveValue('desc')

    fireEvent.change(input, { target: { value: 'bob' } })
    fireEvent.submit(form)
    advance(300)
    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith(
      '/en/admin/users?search=bob&sortBy=name&sortOrder=desc',
      { scroll: false }
    )
  })

  it('clears immediately without a later duplicate and restores field focus', () => {
    renderDiscovery({ search: 'alice' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    advance(300)
    expect(replaceMock).toHaveBeenCalledOnce()
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?sortBy=createdAt', {
      scroll: false,
    })
    expect(screen.getByLabelText('Search users')).toHaveFocus()
  })

  it('lets a discrete discovery link discard an armed draft before navigation', () => {
    renderDiscovery({ search: 'alice' })
    const input = screen.getByLabelText('Search users')
    fireEvent.change(input, { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('link', { name: 'Sort by name' }))
    expect(input).toHaveValue('alice')
    advance(300)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('does not discard the current-tab draft for a modifier/new-tab activation', () => {
    renderDiscovery({ search: 'alice' })
    const input = screen.getByLabelText('Search users')
    fireEvent.change(input, { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('link', { name: 'Sort by name' }), { metaKey: true })

    expect(input).toHaveValue('pending')
    advance(300)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=pending&sortBy=createdAt', {
      scroll: false,
    })
  })
})
