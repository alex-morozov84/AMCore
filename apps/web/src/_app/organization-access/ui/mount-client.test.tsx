import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { OrganizationAccessClientProps } from '@/_pages/organization-access'

import { OrganizationAccessClientMount } from './mount-client'

const { page, replace } = vi.hoisted(() => ({ page: vi.fn(), replace: vi.fn() }))
vi.mock('next-intl', () => ({ useLocale: () => 'ru' }))
vi.mock('@/_pages/organization-access', () => ({
  OrganizationAccessClient: (props: OrganizationAccessClientProps) => {
    page(props)
    return null
  },
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace }),
}))
const admission = { binding: 'login-binding', actor: { id: 'actor', email: 'actor@example.test' } }

describe('ready content client adapter', () => {
  it('owns ordinary hrefs and replace callback with data-only placement', () => {
    render(
      <OrganizationAccessClientMount
        admission={admission}
        id="org"
        page={1}
        explicitList={false}
        placement={{ organizationsPath: '/manage/organizations', homeHref: '/crm' }}
      />
    )
    const props = page.mock.lastCall![0] as OrganizationAccessClientProps
    expect(props.input).toEqual({ kind: 'selected', id: 'org', locale: 'ru' })
    expect(props.contextHref('other')).toBe('/manage/organizations/other')
    expect(props.pageHref(2)).toBe('/manage/organizations?view=list&page=2')
    expect(props.listHref).toBe('/manage/organizations?view=list')
    expect(props.dashboardHref).toBe('/crm')
    expect(props.loginHref).toBe('/login')
    props.onReplace(props.contextHref('other'))
    expect(replace).toHaveBeenCalledWith('/manage/organizations/other')
    expect(props.onReload).toBeTypeOf('function')
  })
  it('preserves default list admission, escape and shared login', () => {
    render(<OrganizationAccessClientMount admission={admission} page={3} explicitList />)
    const props = page.mock.lastCall![0] as OrganizationAccessClientProps
    expect(props.input).toEqual({ kind: 'list', page: 3, locale: 'ru' })
    expect(props.explicitList).toBe(true)
    expect(props.contextHref('org')).toBe('/organizations/org')
    expect(props.loginHref).toBe('/login')
  })
})
