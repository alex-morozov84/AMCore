import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NewTabLink } from './new-tab-link'

describe('NewTabLink', () => {
  it('opens in a new tab without opener or referrer and announces it', () => {
    render(
      <NewTabLink href="https://example.com/a" newTabLabel="(opens in a new tab)">
        Docs
      </NewTabLink>
    )
    const link = screen.getByRole('link', { name: /Docs/ })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('(opens in a new tab)')).toHaveClass('sr-only')
  })

  it('reports a click to the caller', () => {
    const onClick = vi.fn()
    render(
      <NewTabLink href="https://example.com/a" newTabLabel="(new tab)" onClick={onClick}>
        Docs
      </NewTabLink>
    )
    fireEvent.click(screen.getByRole('link'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
