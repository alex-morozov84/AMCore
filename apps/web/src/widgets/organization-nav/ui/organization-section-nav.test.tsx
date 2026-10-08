import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OrganizationSectionNav } from './organization-section-nav'

vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const messages = {
  organizationNav: {
    sections: 'Organization sections',
    overview: 'Overview',
    members: 'Members',
    invitations: 'Invitations',
    roles: 'Roles',
  },
}

function renderNav(props: React.ComponentProps<typeof OrganizationSectionNav>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OrganizationSectionNav {...props} />
    </NextIntlClientProvider>
  )
}

describe('OrganizationSectionNav', () => {
  it('lists the four sections in a fixed order and marks only the active one', () => {
    renderNav({
      active: 'roles',
      hrefs: {
        roles: '/o/1/roles',
        invitations: '/o/1/invites',
        members: '/o/1/members',
        overview: '/o/1',
      },
    })
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Members',
      'Invitations',
      'Roles',
    ])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      'page',
    ])
    expect(screen.getByRole('navigation', { name: 'Organization sections' })).toBeInTheDocument()
  })

  it('omits a section the caller does not route', () => {
    renderNav({ active: 'overview', hrefs: { overview: '/o/1', members: '/o/1/members' } })
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Overview',
      'Members',
    ])
  })
})
