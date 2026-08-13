import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSessions } from '@/entities/user'

import en from '../../../../messages/en.json'

import { SessionsTable } from './SessionsTable'

vi.mock('@/entities/user', () => ({ useSessions: vi.fn() }))

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <QueryClientProvider client={queryClient}>
        <SessionsTable />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

describe('SessionsTable — current session row', () => {
  it('never renders a revoke action for the current session, only for other rows', () => {
    vi.mocked(useSessions).mockReturnValue({
      data: {
        data: [
          {
            id: 'current',
            userAgent: 'Chrome',
            ipAddress: '1.1.1.1',
            createdAt: '2026-01-01T00:00:00.000Z',
            current: true,
          },
          {
            id: 'other',
            userAgent: 'Safari',
            ipAddress: '2.2.2.2',
            createdAt: '2026-01-02T00:00:00.000Z',
            current: false,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      },
      isPending: false,
      isError: false,
    } as never)

    renderTable()

    // Exactly one row-actions trigger exists — the current row's cell
    // renders `null` instead of a DropdownMenuTrigger.
    expect(screen.getAllByRole('button', { name: 'Actions' })).toHaveLength(1)
    expect(screen.getByText('This device')).toBeInTheDocument()
  })
})
