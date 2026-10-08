import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type RoleSummary } from '@amcore/shared'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import messages from '../../../../messages/en.json'

import { OrganizationRoles } from './organization-roles'

const role = (over: Partial<RoleSummary> & { id: string; name: string }): RoleSummary => ({
  description: null,
  isSystem: false,
  organizationId: 'org',
  holderCount: 0,
  ruleCount: 0,
  grantsFullControl: false,
  advancedState: 'none',
  ...over,
})

const state = vi.hoisted(() => ({
  read: {} as Record<string, unknown>,
}))
vi.mock('@/entities/organization-context', () => ({
  useRoleDefinitions: () => state.read,
}))
vi.mock('@/features/role-editor', () => ({ CreateRoleDialog: () => null }))
vi.mock('@/shared/ui/debounced-search-field', () => ({ DebouncedSearchField: () => null }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const controller = {
  binding: 'binding',
  organizationId: 'org',
  refresh: async () => 'ready',
} as never

function available(data: RoleSummary[], total = data.length) {
  state.read = {
    ready: true,
    available: true,
    pending: false,
    busy: false,
    data: { data, total, page: 1, limit: 20, aclVersion: 1 },
  }
}

function view(query = { page: 1, search: '' }, change = vi.fn()) {
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <RoleLinkProvider roleHref={(id) => `/roles/${id}`}>
        <OrganizationRoles
          controller={controller}
          query={query}
          onQueryChange={change}
          onOpenRole={vi.fn()}
        />
      </RoleLinkProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  state.read = {}
})

describe('OrganizationRoles', () => {
  it('keeps built-in roles apart from the editable table', () => {
    available([
      role({ id: 'a', name: 'ADMIN', isSystem: true, organizationId: null, holderCount: 2 }),
      role({
        id: 'c',
        name: 'Support',
        description: 'Handles requests',
        ruleCount: 3,
        holderCount: 1,
        advancedState: 'present',
        grantsFullControl: true,
      }),
    ])
    render(view())
    const builtin = screen.getByRole('region', { name: 'Built-in roles' })
    expect(within(builtin).getByRole('link', { name: 'Open role ADMIN' })).toBeInTheDocument()
    expect(within(builtin).queryByText('Support')).toBeNull()
    const custom = screen.getByRole('region', { name: 'Your roles' })
    expect(within(custom).getAllByText('Support').length).toBeGreaterThan(0)
    expect(within(custom).queryByText('ADMIN')).toBeNull()
    expect(within(custom).getAllByText('3 rules').length).toBeGreaterThan(0)
    expect(within(custom).getAllByText('Advanced rules').length).toBeGreaterThan(0)
    expect(within(custom).getAllByText('Full control').length).toBeGreaterThan(0)
  })

  it('tells an empty organization from an empty search', () => {
    available([role({ id: 'a', name: 'ADMIN', isSystem: true, organizationId: null })])
    const { rerender } = render(view())
    expect(screen.getByText(/No custom roles yet/)).toBeInTheDocument()
    rerender(view({ page: 1, search: 'zzz' }))
    expect(screen.getByText('No roles match this search.')).toBeInTheDocument()
  })

  it('hides stale rows when the current read failed and offers a retry', () => {
    state.read = {
      ready: true,
      available: false,
      pending: false,
      busy: false,
      error: new Error('x'),
      data: {
        data: [role({ id: 'c', name: 'Stale role' })],
        total: 1,
        page: 1,
        limit: 20,
        aclVersion: 1,
      },
    }
    render(view())
    expect(screen.queryByText('Stale role')).toBeNull()
    expect(screen.getByText('Roles could not be loaded. Nothing was changed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it.each([31, 1, 0])('moves a page past the end back once: total %s', (total) => {
    available([], total)
    const change = vi.fn()
    const { rerender } = render(view({ page: 100, search: 'x' }, change))
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith(
      { page: Math.max(1, Math.ceil(total / 20)), search: 'x' },
      'page'
    )
    rerender(view({ page: 100, search: 'x' }, change))
    expect(change).toHaveBeenCalledTimes(1)
  })
})
