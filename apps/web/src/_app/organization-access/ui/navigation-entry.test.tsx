import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/shared/ui/sidebar'

import { OrganizationNavigationEntry } from './navigation-entry'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: (props: React.ComponentProps<'a'>) => <a {...props}>{props.children}</a>,
}))

describe('organization menu placement', () => {
  it.each([undefined, { organizationsPath: '/manage/organizations', homeHref: '/crm' }])(
    'uses the same ordinary placement %s',
    (placement) => {
      render(
        <SidebarProvider>
          <ul>
            <OrganizationNavigationEntry placement={placement} />
          </ul>
        </SidebarProvider>
      )
      expect(screen.getByRole('link', { name: 'title' })).toHaveAttribute(
        'href',
        placement?.organizationsPath ?? '/organizations'
      )
    }
  )
})
