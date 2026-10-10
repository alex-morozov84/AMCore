import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PaginationButtons } from './pagination'

vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: 'a' }))

const labels = { previousLabel: 'Previous', nextLabel: 'Next' }

describe('local-state pagination', () => {
  it('preserves known-total boundaries and hides a single page', async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(
      <PaginationButtons
        {...labels}
        page={1}
        pageSize={25}
        total={26}
        onPageChange={onPageChange}
      />
    )
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    rerender(
      <PaginationButtons
        {...labels}
        page={2}
        pageSize={25}
        total={26}
        onPageChange={onPageChange}
      />
    )
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    rerender(
      <PaginationButtons
        {...labels}
        page={1}
        pageSize={25}
        total={25}
        onPageChange={onPageChange}
      />
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('honors explicit window boundaries and blocks transitions while fetching', async () => {
    const onPageChange = vi.fn()
    const props = {
      ...labels,
      page: 3,
      pageLabel: 'Page 3',
      hasPreviousPage: true,
      hasNextPage: false,
      onPageChange,
    }
    const { rerender } = render(<PaginationButtons {...props} />)
    expect(screen.getByText('Page 3')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    onPageChange.mockClear()
    rerender(<PaginationButtons {...props} isFetching />)
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })
})
