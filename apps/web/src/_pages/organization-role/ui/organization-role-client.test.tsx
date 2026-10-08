import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OrganizationRoleClient } from './organization-role-client'

const state = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  role: {} as Record<string, unknown>,
  catalogue: {} as Record<string, unknown>,
}))
vi.mock('@/entities/organization-context', () => ({
  useOrganizationContext: () => state.context,
  useRoleDefinition: () => state.role,
  useCapabilityCatalogue: () => state.catalogue,
}))
vi.mock('@/features/role-editor', () => ({
  RoleEditor: () => <div data-testid="editor">editor</div>,
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// The catalogue of the project's default locale, loaded by code so no locale file is hard-wired.
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.organizationRoles
const say = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'organizationRoles' })

const admission = { binding: 'binding', actor: { id: 'actor' } } as never
const hrefs = { overview: '/o', members: '/o/members', roles: '/o/roles' }
const detail = {
  role: { id: 'r1', name: 'Support', description: null, isSystem: false, organizationId: 'o' },
  editMode: 'editable',
  ruleCount: 0,
}
const context = (status: string, canManageTeamAccess: boolean) => ({
  state: { status },
  data: { data: { canManageTeamAccess, organization: { id: 'o', name: 'Acme' } } },
  controller: { refresh: vi.fn() },
  initialPending: false,
})
const view = () => (
  <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
    <OrganizationRoleClient
      admission={admission}
      organizationId="o"
      roleId="r1"
      hrefs={hrefs as never}
    />
  </NextIntlClientProvider>
)

beforeEach(() => {
  state.context = context('ready', true)
  state.role = { data: detail, ready: true, available: true }
  state.catalogue = { data: { capabilities: [] }, ready: true, available: true }
})

describe('OrganizationRoleClient authority', () => {
  it('shows the editor while the role is allowed', () => {
    render(view())
    expect(screen.getByTestId('editor')).toBeInTheDocument()
  })

  it('keeps the editor in place while permission is only being rechecked', () => {
    state.context = context('pending', true)
    state.role = { data: detail, ready: false, available: false }
    render(view())
    expect(screen.getByTestId('editor')).toBeInTheDocument()
  })

  it('hides the editor and its cached data once the check resolves to no team access', () => {
    state.context = context('ready', false)
    state.role = { data: detail, ready: false, available: false }
    state.catalogue = { data: { capabilities: [] }, ready: false, available: false }
    render(view())
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(screen.getByText(t.denied)).toBeInTheDocument()
    expect(screen.queryByText('Support')).toBeNull()
  })

  it('hides the editor when authority is lost altogether', () => {
    state.context = context('denied', false)
    render(view())
    expect(screen.queryByTestId('editor')).toBeNull()
  })
})

describe('without JavaScript', () => {
  it('tells the person why the page cannot be used', () => {
    state.context = { ...context('pending', true), data: undefined, initialPending: true }
    state.role = { data: undefined, ready: false, available: false, pending: true }
    state.catalogue = { data: undefined, ready: false, available: false, pending: true }
    const html = renderToStaticMarkup(view())
    expect(html).toContain(`<noscript>`)
    expect(html).toContain(say('javascriptRequired'))
  })
})
