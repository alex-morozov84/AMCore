import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { AdminOrganizationResponse } from '@amcore/shared'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/admin/organizations',
}))
vi.mock('next-intl/server', () => ({
  getFormatter: vi.fn().mockResolvedValue({ dateTime: () => 'Sep 21, 2026, 10:00 AM' }),
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, string>) => {
    if (key === 'sortColumnAction') return `Sort by ${values?.column}, ${values?.direction}`
    return (consoleMessages as Record<string, string>)[key] ?? key
  }),
}))

import { OrganizationsTable, type OrganizationsTableProps } from './OrganizationsTable'
import { ORGANIZATIONS_SORTABLE_FIELDS } from './parse-query'

const consoleMessages = {
  organizationsColumnName: 'Name',
  organizationsColumnSlug: 'Slug',
  organizationsColumnCreated: 'Created',
  organizationsColumnUpdated: 'Updated',
  sortAscending: 'ascending',
  sortDescending: 'descending',
}

const organization: AdminOrganizationResponse = {
  id: 'org-1',
  name: 'Acme Inc',
  slug: 'acme-inc',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

async function renderTable(overrides: Partial<OrganizationsTableProps> = {}) {
  const table = await OrganizationsTable({
    organizations: [organization],
    baseHref: '/en/admin/organizations',
    sortBy: 'createdAt',
    ...overrides,
  })
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ console: consoleMessages }}>
      {table}
    </NextIntlClientProvider>
  )
}

describe('OrganizationsTable', () => {
  it('marks the active sort column with aria-sort and a directional accessible label', async () => {
    await renderTable({ sortBy: 'createdAt', sortOrder: 'desc' })

    const createdHeader = screen.getByRole('columnheader', { name: 'Sort by Created, ascending' })
    expect(createdHeader).toHaveAttribute('aria-sort', 'descending')
  })

  it('leaves inactive sort columns unmarked and pointed at their own default direction', async () => {
    await renderTable({ sortBy: 'createdAt', sortOrder: 'desc' })

    const nameHeader = screen.getByRole('columnheader', { name: 'Sort by Name, ascending' })
    // Only the currently-sorted header carries `aria-sort` at all.
    expect(nameHeader).not.toHaveAttribute('aria-sort')
    // An inactive sortable column must still show *some* icon — otherwise
    // nothing on screen distinguishes it from a plain, non-sortable header
    // until it's clicked.
    expect(nameHeader.querySelector('svg')).toBeInTheDocument()
  })

  it('carries the current search into every sortable header link', async () => {
    await renderTable({ search: 'acme', sortBy: 'name', sortOrder: 'asc' })

    const slugLink = screen.getByRole('link', { name: 'Sort by Slug, ascending' })
    expect(slugLink).toHaveAttribute(
      'href',
      '/en/admin/organizations?search=acme&sortBy=slug&sortOrder=asc'
    )
  })

  it('renders exactly one sortable header per ORGANIZATIONS_SORTABLE_FIELDS entry — no more, no fewer', async () => {
    // Mechanical enforcement that the rendered headers and the route's
    // `sortBy` allowlist can never silently drift apart.
    await renderTable()

    const sortLinks = screen.getAllByRole('link', { name: /^Sort by/ })
    const renderedColumns = sortLinks
      .map((link) => new URL(link.getAttribute('href')!, 'https://x').searchParams.get('sortBy'))
      .sort()
    expect(renderedColumns).toEqual([...ORGANIZATIONS_SORTABLE_FIELDS].sort())
  })
})
