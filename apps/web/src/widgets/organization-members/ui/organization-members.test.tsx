import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const messages = {
  organizationMembers: {
    title: 'Members',
    memberSearchPlaceholder: 'Search',
    count: '{count} members',
    empty: 'Empty',
    pageStatus: 'Page {page} of {totalPages}',
    previous: 'Previous',
    next: 'Next',
    roleFilter: 'Showing people with the role {name}',
    roleFilterUnknown: 'Showing people with one role',
    roleFilterClear: 'Show everyone',
  },
}

import { OrganizationMembers } from './organization-members'

const state = vi.hoisted(() => ({ total: 31 }))
vi.mock('@/entities/organization-context', () => ({
  useRoleDefinition: () => ({ data: { role: { name: 'Support agent' } } }),
  useOrganizationMembers: (_c: unknown, q: { page: number }) => ({
    ready: true,
    pending: false,
    data: { total: state.total, page: q.page, data: q.page === 1 ? [{}] : [] },
  }),
}))
vi.mock('@/features/member-role-assignment', () => ({
  MemberSearch: () => null,
  MemberRoleDialog: () => <input aria-label="dirty draft" defaultValue="preserved" />,
}))
vi.mock('./member-table', () => ({
  MemberTable: ({ onEdit }: { onEdit: (id: string) => void }) => (
    <button onClick={() => onEdit('user')}>Edit fixture</button>
  ),
}))
const controller = { binding: 'binding', organizationId: 'org' } as never
function view(
  page: number,
  change: (q: { page: number; search: string; roleId?: string }) => void,
  roleId?: string
) {
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <OrganizationMembers
        controller={controller}
        actorId="actor"
        query={{ page, search: 'literal', ...(roleId ? { roleId } : {}) }}
        onQueryChange={change}
      />
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  state.total = 31
})
it.each([31, 1, 0])(
  'recovers a direct page100 once without empty/one-page loop: total%s',
  (total) => {
    state.total = total
    const change = vi.fn()
    const { rerender } = render(view(100, change))
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith(
      { page: Math.max(1, Math.ceil(total / 20)), search: 'literal' },
      'page'
    )
    rerender(view(100, change))
    expect(change).toHaveBeenCalledTimes(1)
  }
)
it('total shrink preserves dirty editor and delegates navigation', () => {
  const change = vi.fn()
  const { rerender } = render(view(1, change))
  fireEvent.click(screen.getByRole('button', { name: 'Edit fixture' }))
  fireEvent.change(screen.getByLabelText('dirty draft'), { target: { value: 'unsaved' } })
  state.total = 0
  rerender(view(2, change))
  expect(change).toHaveBeenLastCalledWith({ page: 1, search: 'literal' }, 'page')
  expect(screen.getByLabelText('dirty draft')).toHaveValue('unsaved')
})

it('names the role filter and clearing it keeps the search and returns to page one', () => {
  const change = vi.fn()
  render(view(2, change, 'role-1'))
  expect(screen.getByText('Showing people with the role Support agent')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }))
  expect(change).toHaveBeenCalledWith({ page: 1, search: 'literal' }, 'search')
})
