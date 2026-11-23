import { PRODUCT_ADMIN_CONFIG } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/shared/ui/sidebar'

import { OrganizationNavigationEntry } from './navigation-entry'

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/organizations' }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: (props: React.ComponentProps<'a'>) => <a {...props}>{props.children}</a>,
}))

const prefix = PRODUCT_ADMIN_CONFIG.mode === 'path' ? `/${PRODUCT_ADMIN_CONFIG.alias}` : ''

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
      expect(screen.getAllByRole('link', { name: 'title' })[0]).toHaveAttribute(
        'href',
        `${placement?.organizationsPath ?? `${prefix}/organizations`}?view=list`
      )
    }
  )
})
