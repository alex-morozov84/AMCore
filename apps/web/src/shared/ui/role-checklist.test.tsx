import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import { RoleChecklist } from './role-checklist'

vi.mock('./route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const roles = [{ id: 'r1', name: 'Support', description: null, isSystem: false }]
const labels = {
  system: 'Built-in',
  custom: 'Custom',
  noDescription: 'No description',
  empty: 'None',
  details: 'Details',
  detailsFor: (name: string) => `Open the role ${name} in a new tab`,
}
const base = { roles, selected: [], disabled: false, readOnly: false, onChange: vi.fn(), labels }

describe('RoleChecklist details link', () => {
  it('opens the role in a new tab so the selection being made is kept', () => {
    render(
      <RoleLinkProvider roleHref={(id) => `/roles/${id}`}>
        <RoleChecklist {...base} />
      </RoleLinkProvider>
    )
    const link = screen.getByRole('link', { name: 'Open the role Support in a new tab' })
    expect(link).toHaveAttribute('href', '/roles/r1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('shows no link without a destination', () => {
    render(<RoleChecklist {...base} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
