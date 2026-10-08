import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import { RoleBadges } from './role-badges'

vi.mock('./route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const roles = [
  { id: 'r1', name: 'Support', description: 'Helps' },
  { id: 'r 2', name: 'Billing', description: null },
]

describe('RoleBadges', () => {
  it('opens the role when a destination is given', () => {
    render(
      <RoleLinkProvider roleHref={(id) => `/roles/${encodeURIComponent(id)}`}>
        <RoleBadges roles={roles} empty="none" missingDescription="no description" />
      </RoleLinkProvider>
    )
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/roles/r1')
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/roles/r%202')
  })

  it('stays a plain description trigger without a destination', () => {
    render(<RoleBadges roles={roles} empty="none" missingDescription="no description" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument()
  })
})
