import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UserAvatar } from './UserAvatar'

describe('UserAvatar', () => {
  it('shows the initials as text by default', () => {
    render(<UserAvatar name="Ada Lovelace" />)

    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('draws the initials with CSS when decorative, so the visible text stays empty', () => {
    const { container } = render(<UserAvatar name="Ada Lovelace" decorative />)

    expect(screen.queryByText('AL')).not.toBeInTheDocument()
    const avatar = container.firstElementChild
    expect(avatar).toHaveAttribute('data-initials', 'AL')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).toHaveTextContent('')
  })

  it('gives a decorative image an empty alt and a plain one the name', () => {
    const { rerender } = render(<UserAvatar name="Ada Lovelace" avatarUrl="/a.webp" decorative />)
    expect(screen.getByRole('presentation')).toHaveAttribute('alt', '')

    rerender(<UserAvatar name="Ada Lovelace" avatarUrl="/a.webp" />)
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument()
  })

  it('falls back to the user icon when there is no name', () => {
    const { container } = render(<UserAvatar decorative />)

    expect(container.querySelector('svg')).not.toBeNull()
  })
})
