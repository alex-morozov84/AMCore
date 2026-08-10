import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'

describe('Empty', () => {
  it('renders the full composition with each slot present', () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia data-testid="media">📭</EmptyMedia>
          <EmptyTitle>No results</EmptyTitle>
          <EmptyDescription>Try a different search.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>Content</EmptyContent>
      </Empty>
    )

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Try a different search.')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('defaults EmptyMedia to the transparent variant', () => {
    render(<EmptyMedia data-testid="media">icon</EmptyMedia>)

    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'default')
    expect(media).toHaveClass('bg-transparent')
  })

  it('switches EmptyMedia to the muted icon-chip style when variant is icon', () => {
    render(
      <EmptyMedia data-testid="media" variant="icon">
        icon
      </EmptyMedia>
    )

    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'icon')
    expect(media).toHaveClass('bg-muted')
  })
})
