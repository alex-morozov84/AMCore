import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

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
    const link = screen.getByRole('link', { name: 'Details: Open the role Support in a new tab' })
    expect(link).toHaveAttribute('href', '/roles/r1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it.each(
    [en, ru].flatMap((messages, locale) =>
      ['organizationMembers', 'organizationInvitations'].map((namespace) => ({
        locale,
        namespace,
        copy: messages[namespace as 'organizationMembers' | 'organizationInvitations'],
      }))
    )
  )('includes the visible label for locale $locale, $namespace', ({ copy }) => {
    render(
      <RoleLinkProvider roleHref={(id) => `/roles/${id}`}>
        <RoleChecklist
          {...base}
          labels={{
            ...labels,
            details: copy.roleDetails,
            detailsFor: (name) => copy.roleDetailsFor.replace('{name}', name),
          }}
        />
      </RoleLinkProvider>
    )
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent(copy.roleDetails)
    expect(link).toHaveAccessibleName(
      `${copy.roleDetails}: ${copy.roleDetailsFor.replace('{name}', 'Support')}`
    )
  })

  it('uses visible text as the name when no contextual label is supplied', () => {
    render(
      <RoleLinkProvider roleHref={(id) => `/roles/${id}`}>
        <RoleChecklist {...base} labels={{ ...labels, detailsFor: undefined }} />
      </RoleLinkProvider>
    )
    expect(screen.getByRole('link', { name: 'Details' })).not.toHaveAttribute('aria-label')
  })

  it('shows no link without a destination', () => {
    render(<RoleChecklist {...base} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
